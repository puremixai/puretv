package outbound

import (
	"bufio"
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestSameOriginRedirectRetainsCredentialsAndIgnoresEnvironmentProxy(t *testing.T) {
	t.Setenv("HTTP_PROXY", "http://127.0.0.1:1")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer own" || r.Header.Get("Cookie") != "own=1" {
			t.Error("same-origin credentials lost")
		}
		if r.URL.Path == "/start" {
			http.Redirect(w, r, "/final", 302)
			return
		}
		fmt.Fprint(w, "ok")
	}))
	defer server.Close()
	client, err := NewClient(Options{AllowedOrigins: []string{server.URL}})
	if err != nil {
		t.Fatal(err)
	}
	req, _ := http.NewRequest("GET", server.URL+"/start", nil)
	req.Header.Set("Authorization", "Bearer own")
	req.Header.Set("Cookie", "own=1")
	res, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
}

func TestDNSAndHeadersHaveStageTimeoutsButBodiesHaveNoTotalLimit(t *testing.T) {
	client := testClient(t, Options{Timeout: 20 * time.Millisecond}, func(ctx context.Context, _ string) ([]netip.Addr, error) {
		<-ctx.Done()
		return nil, ctx.Err()
	}, noDial, nil)
	if _, err := client.Get("http://cdn.example/video"); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("DNS timeout: %v", err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/headers" {
			<-r.Context().Done()
			return
		}
		w.WriteHeader(200)
		w.(http.Flusher).Flush()
		time.Sleep(75 * time.Millisecond)
		fmt.Fprint(w, "long body")
	}))
	defer server.Close()
	client, _ = NewClient(Options{AllowedOrigins: []string{server.URL}, Timeout: 20 * time.Millisecond})
	if _, err := client.Get(server.URL + "/headers"); err == nil {
		t.Fatal("response-header timeout missing")
	}
	res, err := client.Get(server.URL + "/body")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	body, err := io.ReadAll(res.Body)
	if err != nil || string(body) != "long body" {
		t.Fatalf("body was limited by stage timeout: %q %v", body, err)
	}
}

func TestHTTPDestinationUsesNumericConnectWithoutLeakingProxyAuth(t *testing.T) {
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "CONNECT" || r.Host != "93.184.216.34:80" {
			t.Errorf("invalid CONNECT: %s %s", r.Method, r.Host)
			http.Error(w, "bad CONNECT", 400)
			return
		}
		if r.Header.Get("Proxy-Authorization") == "" {
			t.Error("missing configured proxy credentials")
		}
		conn, rw, err := w.(http.Hijacker).Hijack()
		if err != nil {
			t.Error(err)
			return
		}
		defer conn.Close()
		fmt.Fprint(rw, "HTTP/1.1 200 Connection Established\r\n\r\n")
		rw.Flush()
		request, err := http.ReadRequest(bufio.NewReader(rw))
		if err != nil {
			t.Error(err)
			return
		}
		if request.RequestURI != "/a%2Fb?sig=a%2Fb%26c" || request.Host != "cdn.example" || request.Header.Get("Proxy-Authorization") != "" {
			t.Errorf("tunneled request changed: %s %s", request.RequestURI, request.Host)
		}
		fmt.Fprint(conn, "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok")
	}))
	defer proxy.Close()
	proxyURL, _ := url.Parse(proxy.URL)
	proxyURL.User = url.UserPassword("username", "password")
	client := testClient(t, Options{ProxyURL: proxyURL.String()}, func(context.Context, string) ([]netip.Addr, error) {
		return []netip.Addr{netip.MustParseAddr("93.184.216.34")}, nil
	}, func(ctx context.Context, network, addr string) (net.Conn, error) {
		if addr != proxy.Listener.Addr().String() {
			t.Fatalf("unexpected transport destination %q", addr)
		}
		return (&net.Dialer{}).DialContext(ctx, network, addr)
	}, nil)
	res, err := client.Get("http://cdn.example/a%2Fb?sig=a%2Fb%26c")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if body, _ := io.ReadAll(res.Body); string(body) != "ok" {
		t.Fatal(string(body))
	}
}

func TestProxyRetriesValidatedTargetsWithoutResolvingAgain(t *testing.T) {
	var targets []string
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "CONNECT" {
			t.Error("proxy request bypassed CONNECT")
			http.Error(w, "CONNECT required", 400)
			return
		}
		targets = append(targets, r.Host)
		if r.Header.Get("Proxy-Authorization") != "Basic dXNlcjpwYXNz" {
			t.Error("retry lost configured proxy authentication")
		}
		if r.Host == "[2606:4700:4700::1111]:80" {
			http.Error(w, "IPv6 egress unavailable", http.StatusBadGateway)
			return
		}
		if r.Host != "93.184.216.34:80" {
			t.Errorf("unvalidated CONNECT target %q", r.Host)
			http.Error(w, "unexpected target", 400)
			return
		}
		conn, rw, err := w.(http.Hijacker).Hijack()
		if err != nil {
			t.Error(err)
			return
		}
		defer conn.Close()
		fmt.Fprint(rw, "HTTP/1.1 200 Connection Established\r\n\r\n")
		rw.Flush()
		request, err := http.ReadRequest(bufio.NewReader(rw))
		if err != nil {
			t.Error(err)
			return
		}
		if request.Host != "cdn.example" || request.Header.Get("Proxy-Authorization") != "" || request.Header.Get("Authorization") != "Bearer source" {
			t.Error("origin identity or credentials changed after proxy retry")
		}
		fmt.Fprint(conn, "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok")
	}))
	defer proxy.Close()
	proxyURL, _ := url.Parse(proxy.URL)
	proxyURL.User = url.UserPassword("user", "pass")
	lookups, dials := 0, 0
	client := testClient(t, Options{ProxyURL: proxyURL.String()}, func(_ context.Context, host string) ([]netip.Addr, error) {
		lookups++
		if host != "cdn.example" || lookups != 1 {
			t.Error("retry performed an additional DNS lookup")
		}
		return []netip.Addr{netip.MustParseAddr("2606:4700:4700::1111"), netip.MustParseAddr("93.184.216.34")}, nil
	}, func(ctx context.Context, network, address string) (net.Conn, error) {
		dials++
		if address != proxy.Listener.Addr().String() {
			t.Errorf("retry bypassed the pinned proxy: %q", address)
			return nil, errors.New("unexpected dial")
		}
		return (&net.Dialer{}).DialContext(ctx, network, address)
	}, nil)
	req, _ := http.NewRequest("GET", "http://cdn.example/media", nil)
	req.Header.Set("Authorization", "Bearer source")
	res, err := client.Do(req)
	if err != nil {
		t.Fatalf("reachable second IP was not attempted: %v", err)
	}
	defer res.Body.Close()
	if body, _ := io.ReadAll(res.Body); string(body) != "ok" {
		t.Fatalf("unexpected response %q", body)
	}
	if fmt.Sprint(targets) != "[[2606:4700:4700::1111]:80 93.184.216.34:80]" || lookups != 1 || dials != 2 {
		t.Fatalf("fallback targets=%v lookups=%d dials=%d", targets, lookups, dials)
	}
}

func TestProxyTargetRetriesShareOneConnectionDeadline(t *testing.T) {
	var mu sync.Mutex
	var deadlines []time.Time
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "target unavailable", http.StatusBadGateway)
	}))
	defer proxy.Close()
	client := testClient(t, Options{ProxyURL: proxy.URL, Timeout: time.Second}, func(context.Context, string) ([]netip.Addr, error) {
		return []netip.Addr{netip.MustParseAddr("93.184.216.34"), netip.MustParseAddr("93.184.216.35")}, nil
	}, func(ctx context.Context, network, address string) (net.Conn, error) {
		deadline, ok := ctx.Deadline()
		if !ok {
			t.Error("proxy dial is missing the shared connection deadline")
		}
		mu.Lock()
		deadlines = append(deadlines, deadline)
		mu.Unlock()
		return (&net.Dialer{}).DialContext(ctx, network, address)
	}, nil)
	if res, err := client.Get("http://cdn.example/media"); err == nil {
		res.Body.Close()
		t.Fatal("failed targets were accepted")
	}
	mu.Lock()
	defer mu.Unlock()
	if len(deadlines) != 2 || deadlines[0].IsZero() || !deadlines[0].Equal(deadlines[1]) {
		t.Fatalf("each target received a fresh timeout: %v", deadlines)
	}
}

func TestProxyCannotGrantAccessToPrivateDestination(t *testing.T) {
	dials := 0
	client := testClient(t, Options{ProxyURL: "http://proxy.example:8080"}, noDNS, func(ctx context.Context, network, addr string) (net.Conn, error) {
		dials++
		return noDial(ctx, network, addr)
	}, nil)
	if _, err := client.Get("http://127.0.0.1/internal"); err == nil {
		t.Fatal("proxy granted destination LAN access")
	}
	if dials != 0 {
		t.Fatal("private destination reached proxy")
	}
}

func TestCancelDuringConnectClosesProxySocket(t *testing.T) {
	started, closed := make(chan struct{}), make(chan struct{})
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, _, err := w.(http.Hijacker).Hijack()
		if err != nil {
			t.Error(err)
			return
		}
		defer conn.Close()
		close(started)
		io.Copy(io.Discard, conn)
		close(closed)
	}))
	defer proxy.Close()
	client := testClient(t, Options{ProxyURL: proxy.URL}, func(context.Context, string) ([]netip.Addr, error) {
		return []netip.Addr{netip.MustParseAddr("93.184.216.34")}, nil
	}, (&net.Dialer{}).DialContext, nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", "http://cdn.example/video", nil)
	done := make(chan error, 1)
	go func() { _, err := client.Do(req); done <- err }()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("CONNECT did not start")
	}
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("unexpected cancellation: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("client did not cancel")
	}
	select {
	case <-closed:
	case <-time.After(time.Second):
		t.Fatal("CONNECT socket remained open")
	}
}

func TestHTTPSDowngradeStripsCredentialsAndTLSRejectsWrongHostname(t *testing.T) {
	plain := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" || r.Header.Get("Cookie") != "" {
			t.Error("credentials crossed HTTPS downgrade")
		}
		fmt.Fprint(w, "ok")
	}))
	defer plain.Close()
	_, plainPort, _ := net.SplitHostPort(plain.Listener.Addr().String())
	secure := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "http://example.com:"+plainPort+"/final", 302)
	}))
	defer secure.Close()
	_, securePort, _ := net.SplitHostPort(secure.Listener.Addr().String())
	roots := x509.NewCertPool()
	roots.AddCert(secure.Certificate())
	client := testClient(t, Options{}, func(context.Context, string) ([]netip.Addr, error) {
		return []netip.Addr{netip.MustParseAddr("93.184.216.34")}, nil
	}, func(ctx context.Context, network, addr string) (net.Conn, error) {
		_, port, _ := net.SplitHostPort(addr)
		if port != plainPort && port != securePort {
			return nil, errors.New("unexpected port")
		}
		return (&net.Dialer{}).DialContext(ctx, network, net.JoinHostPort("127.0.0.1", port))
	}, roots)
	req, _ := http.NewRequest("GET", "https://example.com:"+securePort+"/start", nil)
	req.Header.Set("Authorization", "Bearer own")
	req.Header.Set("Cookie", "own=1")
	res, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if _, err := client.Get("https://wrong.invalid:" + securePort + "/start"); err == nil {
		t.Fatal("logical TLS hostname was not verified")
	}
}

func testClient(t *testing.T, opts Options, lookup func(context.Context, string) ([]netip.Addr, error), dial func(context.Context, string, string) (net.Conn, error), roots *x509.CertPool) *http.Client {
	t.Helper()
	client, err := newClient(opts, dependencies{lookup: lookup, dial: dial, tlsConfig: &tls.Config{RootCAs: roots}})
	if err != nil {
		t.Fatal(err)
	}
	return client
}

func noDNS(context.Context, string) ([]netip.Addr, error) {
	return nil, fmt.Errorf("unexpected DNS: external network forbidden")
}
func noDial(context.Context, string, string) (net.Conn, error) {
	return nil, fmt.Errorf("unexpected dial: external network forbidden")
}

func TestRejectsNonPublicTargetsBeforeDial(t *testing.T) {
	for _, host := range []string{"127.0.0.1", "10.0.0.1", "169.254.169.254", "0.0.0.0", "224.0.0.1", "100.64.0.1", "192.0.2.1", "198.18.0.1", "[::1]", "[fe80::1]", "[fc00::1]", "[::ffff:127.0.0.1]", "[2002:7f00:1::]"} {
		t.Run(host, func(t *testing.T) {
			dials := 0
			client := testClient(t, Options{}, noDNS, func(ctx context.Context, network, addr string) (net.Conn, error) {
				dials++
				return noDial(ctx, network, addr)
			}, nil)
			if _, err := client.Get("http://" + host + "/private"); err == nil {
				t.Fatal("non-public target accepted")
			}
			if dials != 0 {
				t.Fatalf("dialed before rejecting target: %d", dials)
			}
		})
	}
}

func TestTrustedOriginStillRejectsForbiddenAddresses(t *testing.T) {
	for _, origin := range []string{"http://169.254.169.254", "http://0.0.0.0", "http://224.0.0.1", "http://[fe80::1]", "http://198.18.0.1", "http://[fd00:ec2::254]"} {
		dials := 0
		client := testClient(t, Options{AllowedOrigins: []string{origin}}, noDNS, func(ctx context.Context, network, addr string) (net.Conn, error) {
			dials++
			return noDial(ctx, network, addr)
		}, nil)
		if _, err := client.Get(origin + "/a"); err == nil {
			t.Errorf("trusted forbidden origin accepted: %s", origin)
		}
		if dials != 0 {
			t.Errorf("trusted forbidden origin was dialed: %s", origin)
		}
	}
}

func TestExactTrustedOriginAndRequestIdentity(t *testing.T) {
	var gotURI, gotHost, gotUA, gotAuth, gotCookie, gotProxyAuth string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotURI, gotHost, gotUA = r.RequestURI, r.Host, r.UserAgent()
		gotAuth, gotCookie, gotProxyAuth = r.Header.Get("Authorization"), r.Header.Get("Cookie"), r.Header.Get("Proxy-Authorization")
		fmt.Fprint(w, "video")
	}))
	defer server.Close()
	client, err := NewClient(Options{AllowedOrigins: []string{server.URL}})
	if err != nil {
		t.Fatal(err)
	}
	req, _ := http.NewRequest("GET", server.URL+"/a%2Fb?sig=a%2Fb%26c+z", nil)
	req.Host = "spoofed.invalid"
	req.Header.Set("User-Agent", "OpenList custom UA")
	req.Header.Set("Authorization", "Bearer own-origin")
	req.Header.Set("Cookie", "session=own-origin")
	req.Header["proxy-authorization"] = []string{"must-not-leak"}
	res, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if body, _ := io.ReadAll(res.Body); string(body) != "video" {
		t.Fatal(string(body))
	}
	if gotURI != "/a%2Fb?sig=a%2Fb%26c+z" || gotHost != strings.TrimPrefix(server.URL, "http://") || gotUA != "OpenList custom UA" {
		t.Fatalf("identity changed: %q %q %q", gotURI, gotHost, gotUA)
	}
	if gotAuth != "Bearer own-origin" || gotCookie != "session=own-origin" || gotProxyAuth != "" {
		t.Fatalf("credentials: auth=%q cookie=%q proxy=%q", gotAuth, gotCookie, gotProxyAuth)
	}
	u, _ := url.Parse(server.URL)
	client = testClient(t, Options{AllowedOrigins: []string{"http://" + u.Hostname()}}, noDNS, noDial, nil)
	if _, err := client.Get(server.URL); err == nil {
		t.Fatal("another port inherited origin grant")
	}
}

func TestDNSIsValidatedOnceAndDialedNumerically(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, r.Host) }))
	defer server.Close()
	lookups, dials := 0, 0
	client := testClient(t, Options{}, func(_ context.Context, host string) ([]netip.Addr, error) {
		lookups++
		if host != "cdn.example" {
			t.Fatalf("unexpected host %q", host)
		}
		if lookups > 1 {
			return []netip.Addr{netip.MustParseAddr("127.0.0.1")}, nil
		}
		return []netip.Addr{netip.MustParseAddr("93.184.216.34")}, nil
	}, func(ctx context.Context, network, addr string) (net.Conn, error) {
		dials++
		if addr != "93.184.216.34:80" {
			t.Fatalf("unvalidated dial %q", addr)
		}
		return (&net.Dialer{}).DialContext(ctx, network, strings.TrimPrefix(server.URL, "http://"))
	}, nil)
	res, err := client.Get("http://cdn.example/video")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if body, _ := io.ReadAll(res.Body); string(body) != "cdn.example" {
		t.Fatal(string(body))
	}
	if lookups != 1 || dials != 1 {
		t.Fatalf("lookup=%d dial=%d", lookups, dials)
	}
}

func TestMixedDNSFailsBeforeDial(t *testing.T) {
	dials := 0
	client := testClient(t, Options{}, func(context.Context, string) ([]netip.Addr, error) {
		return []netip.Addr{netip.MustParseAddr("93.184.216.34"), netip.MustParseAddr("10.0.0.2")}, nil
	}, func(ctx context.Context, network, addr string) (net.Conn, error) {
		dials++
		return noDial(ctx, network, addr)
	}, nil)
	if _, err := client.Get("https://cdn.example/video"); err == nil {
		t.Fatal("mixed DNS accepted")
	}
	if dials != 0 {
		t.Fatal("mixed DNS reached transport")
	}
}

func TestRedirectsRevalidateAndNeverRestoreCrossOriginCredentials(t *testing.T) {
	var server *httptest.Server
	var requests []string
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests = append(requests, r.Host+r.URL.Path)
		if r.URL.Path != "/start" && (r.Header.Get("Authorization") != "" || r.Header.Get("Cookie") != "") {
			t.Error("credentials crossed an origin")
		}
		switch r.URL.Path {
		case "/start":
			http.Redirect(w, r, "http://sub.cdn.example/next", 302)
		case "/next":
			http.Redirect(w, r, "http://sub.cdn.example/again", 302)
		case "/again":
			http.Redirect(w, r, "http://cdn.example/final", 302)
		default:
			fmt.Fprint(w, "done")
		}
	}))
	defer server.Close()
	lookups := 0
	client := testClient(t, Options{}, func(context.Context, string) ([]netip.Addr, error) {
		lookups++
		return []netip.Addr{netip.MustParseAddr("93.184.216.34")}, nil
	}, func(ctx context.Context, network, addr string) (net.Conn, error) {
		if addr != "93.184.216.34:80" {
			t.Fatalf("bad dial %q", addr)
		}
		return (&net.Dialer{}).DialContext(ctx, network, strings.TrimPrefix(server.URL, "http://"))
	}, nil)
	req, _ := http.NewRequest("GET", "http://cdn.example/start", nil)
	req.Header["authorization"] = []string{"Bearer secret"}
	req.Header["cookie"] = []string{"secret=1"}
	res, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if lookups != 4 || len(requests) != 4 {
		t.Fatalf("each hop must resolve: %d %v", lookups, requests)
	}
}

func TestRedirectToMetadataNeverDialsIt(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "http://169.254.169.254/latest", 302)
	}))
	defer server.Close()
	dials := 0
	client := testClient(t, Options{AllowedOrigins: []string{server.URL}}, noDNS, func(ctx context.Context, network, addr string) (net.Conn, error) {
		dials++
		return (&net.Dialer{}).DialContext(ctx, network, addr)
	}, nil)
	if _, err := client.Get(server.URL); err == nil {
		t.Fatal("metadata redirect accepted")
	}
	if dials != 1 {
		t.Fatalf("unexpected dial count %d", dials)
	}
}

func TestCancellationStopsResponseBody(t *testing.T) {
	closed := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.(http.Flusher).Flush()
		<-r.Context().Done()
		close(closed)
	}))
	defer server.Close()
	client, _ := NewClient(Options{AllowedOrigins: []string{server.URL}})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", server.URL, nil)
	res, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	cancel()
	if _, err := io.ReadAll(res.Body); err == nil {
		t.Fatal("cancel returned a successful truncated body")
	}
	res.Body.Close()
	select {
	case <-closed:
	case <-time.After(time.Second):
		t.Fatal("upstream not canceled")
	}
}

func TestTLSKeepsLogicalHostnameAndProxyConnectPinsBothEndpoints(t *testing.T) {
	for _, secureProxy := range []bool{false, true} {
		t.Run(fmt.Sprint(secureProxy), func(t *testing.T) {
			var gotSNI, gotURI, gotAuth, gotProxyAuth string
			target := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				gotSNI, gotURI = r.TLS.ServerName, r.RequestURI
				gotAuth, gotProxyAuth = r.Header.Get("Authorization"), r.Header.Get("Proxy-Authorization")
				fmt.Fprint(w, "secure media")
			}))
			defer target.Close()
			var connectAddr, proxyAuth string
			var copies sync.WaitGroup
			proxyHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				connectAddr, proxyAuth = r.Host, r.Header.Get("Proxy-Authorization")
				if r.Method != "CONNECT" {
					t.Error("proxy received non-CONNECT request")
					http.Error(w, "CONNECT only", 400)
					return
				}
				upstream, err := net.Dial("tcp", strings.TrimPrefix(target.URL, "https://"))
				if err != nil {
					t.Error(err)
					return
				}
				conn, buffered, err := w.(http.Hijacker).Hijack()
				if err != nil {
					upstream.Close()
					t.Error(err)
					return
				}
				fmt.Fprint(buffered, "HTTP/1.1 200 Connection Established\r\n\r\n")
				buffered.Flush()
				copies.Add(2)
				go func() { defer copies.Done(); io.Copy(upstream, buffered); upstream.Close() }()
				go func() { defer copies.Done(); io.Copy(conn, upstream); conn.Close() }()
			})
			proxy := httptest.NewUnstartedServer(proxyHandler)
			if secureProxy {
				proxy.StartTLS()
			} else {
				proxy.Start()
			}
			defer proxy.Close()
			roots := x509.NewCertPool()
			roots.AddCert(target.Certificate())
			if secureProxy {
				roots.AddCert(proxy.Certificate())
			}
			var dialed []string
			proxyScheme := "http"
			if secureProxy {
				proxyScheme = "https"
			}
			client := testClient(t, Options{ProxyURL: proxyScheme + "://proxy-user:proxy-secret@proxy.example.com:8443"}, func(_ context.Context, host string) ([]netip.Addr, error) {
				if host == "proxy.example.com" {
					return []netip.Addr{netip.MustParseAddr("127.0.0.1")}, nil
				}
				if host == "example.com" {
					return []netip.Addr{netip.MustParseAddr("93.184.216.34")}, nil
				}
				return noDNS(context.Background(), host)
			}, func(ctx context.Context, network, addr string) (net.Conn, error) {
				dialed = append(dialed, addr)
				if addr != "127.0.0.1:8443" {
					return nil, fmt.Errorf("proxy bypass: %s", addr)
				}
				return (&net.Dialer{}).DialContext(ctx, network, proxy.Listener.Addr().String())
			}, roots)
			req, _ := http.NewRequest("GET", "https://example.com/a%2Fb?sig=a%2Fb%26c+z", nil)
			req.Header.Set("Authorization", "Bearer source-auth")
			res, err := client.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			body, err := io.ReadAll(res.Body)
			res.Body.Close()
			if err != nil || string(body) != "secure media" {
				t.Fatalf("body=%q err=%v", body, err)
			}
			copies.Wait()
			if connectAddr != "93.184.216.34:443" || proxyAuth != "Basic cHJveHktdXNlcjpwcm94eS1zZWNyZXQ=" {
				t.Fatalf("CONNECT destination/auth: %q %q", connectAddr, proxyAuth)
			}
			if gotSNI != "example.com" || gotURI != "/a%2Fb?sig=a%2Fb%26c+z" || gotAuth != "Bearer source-auth" || gotProxyAuth != "" {
				t.Fatalf("target identity changed: SNI=%q URI=%q auth=%q proxy=%q", gotSNI, gotURI, gotAuth, gotProxyAuth)
			}
			if len(dialed) != 1 {
				t.Fatalf("unexpected dials %v", dialed)
			}
		})
	}
}

func TestRejectsInvalidConfigurationAndURLs(t *testing.T) {
	for _, origin := range []string{"*", "http://host/path", "http://user:secret@host", "http://host?x=1", "ftp://host"} {
		if _, err := NewClient(Options{AllowedOrigins: []string{origin}}); err == nil {
			t.Errorf("invalid grant accepted: %s", origin)
		}
	}
	for _, proxy := range []string{"socks5://host", "http://host/path", "http://host?x=1"} {
		if _, err := NewClient(Options{ProxyURL: proxy}); err == nil {
			t.Errorf("invalid proxy accepted: %s", proxy)
		}
	}
	client := testClient(t, Options{}, noDNS, noDial, nil)
	for _, target := range []string{"file:///etc/passwd", "http://user:secret@cdn.example/a", "http://[fe80::1%25eth0]/"} {
		if _, err := client.Get(target); err == nil {
			t.Errorf("invalid target accepted: %s", target)
		}
	}
}
