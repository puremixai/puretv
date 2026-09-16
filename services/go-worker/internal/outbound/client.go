// Package outbound provides DNS-pinned HTTP clients for server-owned downloads.
package outbound

import (
	"bufio"
	"context"
	"crypto/tls"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type Options struct {
	// AllowedOrigins contains exact administrator-owned HTTP(S) origins. Grants
	// allow RFC1918, loopback and ULA addresses, never metadata or reserved ranges.
	AllowedOrigins []string
	// ProxyURL is an administrator-owned HTTP(S) CONNECT proxy. Its own endpoint
	// may use LAN addresses; the destination still needs its independent grant.
	ProxyURL string
	// Timeout bounds DNS, connection setup, TLS and response-header waits. Zero
	// selects 30 seconds. It does not limit the total duration of a download;
	// callers use the request context for cancellation or a total deadline.
	Timeout time.Duration
}

type dependencies struct {
	lookup    func(context.Context, string) ([]netip.Addr, error)
	dial      func(context.Context, string, string) (net.Conn, error)
	tlsConfig *tls.Config
}

type transport struct {
	allowed map[string]bool
	proxy   *url.URL
	timeout time.Duration
	deps    dependencies
}

// NewClient never uses HTTP_PROXY/HTTPS_PROXY from the environment. Only the
// explicit ProxyURL can change the route, and CONNECT uses a validated numeric IP.
func NewClient(opts Options) (*http.Client, error) {
	return newClient(opts, dependencies{
		lookup: func(ctx context.Context, host string) ([]netip.Addr, error) {
			return net.DefaultResolver.LookupNetIP(ctx, "ip", host)
		},
	})
}

func newClient(opts Options, deps dependencies) (*http.Client, error) {
	if opts.Timeout < 0 {
		return nil, errors.New("outbound timeout must not be negative")
	}
	if opts.Timeout == 0 {
		opts.Timeout = 30 * time.Second
	}
	t := &transport{allowed: make(map[string]bool), timeout: opts.Timeout, deps: deps}
	if t.deps.dial == nil {
		t.deps.dial = (&net.Dialer{Timeout: opts.Timeout}).DialContext
	}
	for _, value := range opts.AllowedOrigins {
		u, err := parseEndpoint(value, false)
		if err != nil {
			return nil, errors.New("invalid outbound allowed origin")
		}
		origin, err := originOf(u)
		if err != nil {
			return nil, err
		}
		t.allowed[origin] = true
	}
	if opts.ProxyURL != "" {
		var err error
		t.proxy, err = parseEndpoint(opts.ProxyURL, true)
		if err != nil {
			return nil, errors.New("invalid outbound CONNECT proxy")
		}
	}
	return &http.Client{
		Transport: t,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 10 {
				return errors.New("too many outbound redirects")
			}
			origin, err := originOf(req.URL)
			if err != nil {
				return err
			}
			// net/http may copy initial headers again on a later redirect. Once
			// any origin changed, credentials stay removed for the entire chain.
			for _, previous := range via {
				previousOrigin, err := originOf(previous.URL)
				if err != nil {
					return err
				}
				if previousOrigin != origin {
					stripHeaders(req.Header, "Authorization", "Cookie", "Referer")
					break
				}
			}
			return nil
		},
	}, nil
}

func parseEndpoint(value string, credentials bool) (*url.URL, error) {
	u, err := url.Parse(value)
	if err != nil {
		return nil, errors.New("invalid outbound endpoint")
	}
	check := *u
	check.User = nil
	if _, err := originOf(&check); err != nil {
		return nil, err
	}
	if (!credentials && u.User != nil) || (u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" {
		return nil, errors.New("outbound endpoints must be exact origins")
	}
	return u, nil
}

func originOf(u *url.URL) (string, error) {
	if u == nil || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.Opaque != "" {
		return "", errors.New("outbound URL must use HTTP(S) without credentials")
	}
	host := strings.ToLower(u.Hostname())
	if host == "" || strings.ContainsAny(host, "%\\ \t\r\n") {
		return "", errors.New("invalid outbound hostname")
	}
	for _, r := range host {
		if r > 127 {
			return "", errors.New("outbound hostname must be ASCII or punycode")
		}
	}
	port := u.Port()
	if port == "" {
		if u.Scheme == "https" {
			port = "443"
		} else {
			port = "80"
		}
	}
	n, err := strconv.Atoi(port)
	if err != nil || n < 1 || n > 65535 {
		return "", errors.New("invalid outbound port")
	}
	return u.Scheme + "://" + net.JoinHostPort(host, strconv.Itoa(n)), nil
}

var blockedNetworks = func() []netip.Prefix {
	values := []string{"0.0.0.0/8", "100.64.0.0/10", "169.254.0.0/16", "192.0.0.0/24", "192.0.2.0/24", "192.88.99.0/24", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "224.0.0.0/4", "240.0.0.0/4", "2001::/23", "2001:db8::/32", "2002::/16", "3fff::/20"}
	result := make([]netip.Prefix, len(values))
	for i, value := range values {
		result[i] = netip.MustParsePrefix(value)
	}
	return result
}()

var globalIPv6 = netip.MustParsePrefix("2000::/3")
var awsMetadataIPv6 = netip.MustParseAddr("fd00:ec2::254")

func stripHeaders(headers http.Header, names ...string) {
	for key := range headers {
		for _, name := range names {
			if strings.EqualFold(key, name) {
				delete(headers, key)
				break
			}
		}
	}
}

func permittedAddress(address netip.Addr, trusted bool) bool {
	if !address.IsValid() || address.Zone() != "" {
		return false
	}
	address = address.Unmap()
	if address == awsMetadataIPv6 {
		return false
	}
	if address.IsPrivate() || address.IsLoopback() {
		return trusted
	}
	if !address.IsGlobalUnicast() {
		return false
	}
	for _, network := range blockedNetworks {
		if network.Contains(address) {
			return false
		}
	}
	return address.Is4() || globalIPv6.Contains(address)
}

func (t *transport) resolve(ctx context.Context, u *url.URL, trusted bool) ([]netip.Addr, error) {
	host := u.Hostname()
	var addresses []netip.Addr
	if address, err := netip.ParseAddr(host); err == nil {
		addresses = []netip.Addr{address}
	} else {
		lookupCtx, cancel := context.WithTimeout(ctx, t.timeout)
		defer cancel()
		var err error
		addresses, err = t.deps.lookup(lookupCtx, host)
		if err != nil {
			return nil, fmt.Errorf("outbound DNS failed: %w", err)
		}
	}
	if len(addresses) == 0 {
		return nil, errors.New("outbound DNS returned no addresses")
	}
	// Validate every answer before the first connection, not just the chosen IP.
	for _, address := range addresses {
		if !permittedAddress(address, trusted) {
			return nil, errors.New("outbound target resolves to a forbidden network")
		}
	}
	return addresses, nil
}

func (t *transport) dialAddresses(ctx context.Context, addresses []netip.Addr, port string) (net.Conn, error) {
	var lastErr error
	for _, address := range addresses {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		conn, err := t.deps.dial(ctx, "tcp", net.JoinHostPort(address.Unmap().String(), port))
		if err == nil {
			return conn, nil
		}
		lastErr = err
	}
	return nil, lastErr
}

func (t *transport) tlsSettings() *tls.Config {
	config := &tls.Config{MinVersion: tls.VersionTLS12}
	if t.deps.tlsConfig != nil {
		config = t.deps.tlsConfig.Clone()
		config.MinVersion = tls.VersionTLS12
	}
	return config
}

func (t *transport) RoundTrip(req *http.Request) (*http.Response, error) {
	origin, err := originOf(req.URL)
	if err != nil {
		return nil, err
	}
	addresses, err := t.resolve(req.Context(), req.URL, t.allowed[origin])
	if err != nil {
		return nil, err
	}
	port := req.URL.Port()
	if port == "" {
		if req.URL.Scheme == "https" {
			port = "443"
		} else {
			port = "80"
		}
	}
	var proxyAddresses []netip.Addr
	if t.proxy != nil {
		proxyAddresses, err = t.resolve(req.Context(), t.proxy, true)
		if err != nil {
			return nil, err
		}
	}
	// A new transport binds one logical destination to one validated address set.
	// It cannot reuse a socket from a different request or resolve at dial time.
	tr := &http.Transport{
		DisableKeepAlives:      true,
		TLSClientConfig:        t.tlsSettings(),
		TLSHandshakeTimeout:    t.timeout,
		ResponseHeaderTimeout:  t.timeout,
		MaxResponseHeaderBytes: 1 << 20,
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			if t.proxy != nil {
				return t.connectProxy(ctx, proxyAddresses, addresses, port)
			}
			return t.dialAddresses(ctx, addresses, port)
		},
	}
	cloned := req.Clone(req.Context())
	cloned.Host = ""
	stripHeaders(cloned.Header, "Proxy-Authorization", "Host")
	response, err := tr.RoundTrip(cloned)
	if err != nil {
		tr.CloseIdleConnections()
	}
	return response, err
}

type bufferedConn struct {
	net.Conn
	reader *bufio.Reader
}

func (c *bufferedConn) Read(p []byte) (int, error) { return c.reader.Read(p) }

func (t *transport) connectProxy(ctx context.Context, proxies, targets []netip.Addr, targetPort string) (net.Conn, error) {
	// All target attempts share one connection deadline, including proxy dial,
	// proxy TLS and CONNECT. A failed address never grants another full timeout.
	ctx, cancel := context.WithTimeout(ctx, t.timeout)
	defer cancel()
	var lastErr error
	for _, target := range targets {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		conn, err := t.connectProxyTarget(ctx, proxies, target, targetPort)
		if err == nil {
			return conn, nil
		}
		lastErr = err
	}
	return nil, lastErr
}

func (t *transport) connectProxyTarget(ctx context.Context, proxies []netip.Addr, target netip.Addr, targetPort string) (net.Conn, error) {
	proxyPort := t.proxy.Port()
	if proxyPort == "" {
		if t.proxy.Scheme == "https" {
			proxyPort = "443"
		} else {
			proxyPort = "80"
		}
	}
	conn, err := t.dialAddresses(ctx, proxies, proxyPort)
	if err != nil {
		return nil, err
	}
	success := false
	defer func() {
		if !success {
			conn.Close()
		}
	}()
	rawConn := conn
	stopCancel := context.AfterFunc(ctx, func() { rawConn.Close() })
	defer stopCancel()
	deadline := time.Now().Add(t.timeout)
	if requestDeadline, ok := ctx.Deadline(); ok && requestDeadline.Before(deadline) {
		deadline = requestDeadline
	}
	if err = conn.SetDeadline(deadline); err != nil {
		return nil, err
	}
	if t.proxy.Scheme == "https" {
		settings := t.tlsSettings()
		settings.ServerName = t.proxy.Hostname()
		secured := tls.Client(conn, settings)
		if err = secured.HandshakeContext(ctx); err != nil {
			return nil, fmt.Errorf("proxy TLS failed: %w", err)
		}
		conn = secured
	}
	// CONNECT only the numeric destination. The origin TLS layer above this
	// tunnel still uses the logical request hostname for SNI and certificates.
	authority := net.JoinHostPort(target.Unmap().String(), targetPort)
	connect := &http.Request{Method: "CONNECT", URL: &url.URL{Opaque: authority}, Host: authority, Header: make(http.Header)}
	if t.proxy.User != nil {
		password, _ := t.proxy.User.Password()
		credentials := t.proxy.User.Username() + ":" + password
		connect.Header.Set("Proxy-Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte(credentials)))
	}
	if err = connect.Write(conn); err != nil {
		return nil, err
	}
	limited := &io.LimitedReader{R: conn, N: 64 << 10}
	reader := bufio.NewReader(limited)
	response, err := http.ReadResponse(reader, connect)
	if err != nil {
		return nil, fmt.Errorf("invalid proxy CONNECT response: %w", err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("proxy CONNECT failed with status %d", response.StatusCode)
	}
	limited.N = 1<<63 - 1
	if err = conn.SetDeadline(time.Time{}); err != nil {
		return nil, err
	}
	success = true
	return &bufferedConn{Conn: conn, reader: reader}, nil
}
