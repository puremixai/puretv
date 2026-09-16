package cms

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestOperations(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if q.Get("token") != "a&b" {
			t.Error("lost source query")
		}
		if r.Header.Get("Authorization") != "" || r.Header.Get("Cookie") != "" {
			t.Error("leaked credentials")
		}
		if q.Get("ac") == "list" {
			_, _ = w.Write([]byte(`{"class":[{"type_id":1,"type_name":"Movie"}]}`))
			return
		}
		if q.Get("wd") != "word & test" && q.Get("t") != "1&2" {
			t.Error("lost operation params")
		}
		_, _ = w.Write([]byte(`{"pagecount":"2","total":"3","list":[{"vod_id":123,"vod_name":"Video","vod_play_from":"m3u8","vod_play_url":"A$http://a/1.m3u8#B$http://a/2.mp4$$$C$http://a/3.m3u8#D$http://a/4.m3u8","puretv_episodes":"untrusted"}]}`))
	}))
	defer server.Close()
	h := New(server.Client())
	for _, op := range []string{"search", "downstream", "videos", "categories"} {
		t.Run(op, func(t *testing.T) {
			body, _ := json.Marshal(input{URL: server.URL + "?token=a%26b", Operation: op, Query: "word & test", CategoryID: "1&2", Page: "2", Headers: map[string]string{"Authorization": "secret", "Cookie": "secret"}})
			w := httptest.NewRecorder()
			h.ServeHTTP(w, httptest.NewRequest("POST", "/v1/cms", strings.NewReader(string(body))))
			if w.Code != 200 {
				t.Fatal(w.Code, w.Body.String())
			}
			var result map[string]any
			if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			if op == "categories" {
				return
			}
			if result["pagecount"] != float64(2) {
				t.Fatal(result)
			}
			item := result["list"].([]any)[0].(map[string]any)
			urls := item["puretv_episodes"].([]any)
			if op == "downstream" {
				if len(urls) != 2 || urls[0] != "http://a/3.m3u8" {
					t.Fatal(item)
				}
			} else {
				if len(urls) != 3 || urls[0] != "http://a/1.m3u8" {
					t.Fatal(item)
				}
			}
		})
	}
}

func TestInvalidAndBoundedResponses(t *testing.T) {
	for _, body := range []string{`[]`, `{"list":{}}`, `{"list":[{}]}`, `{"pagecount":-1}`, `{"list":[]} {}`, strings.Repeat("x", maxBody+1), `{"list":[{"vod_id":1,"vod_name":"x","vod_play_from":"x","vod_play_url":"` + strings.Repeat("n$https://a/a.m3u8#", 200000) + `"}]}`} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(body)) }))
		h := New(server.Client())
		in, _ := json.Marshal(input{URL: server.URL, Operation: "search", Query: "x"})
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("POST", "/v1/cms", strings.NewReader(string(in))))
		server.Close()
		if w.Code != 502 {
			t.Fatalf("expected rejected payload, got %d", w.Code)
		}
	}
}

func TestTimeoutAndCancellation(t *testing.T) {
	cancelled := make(chan struct{}, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { <-r.Context().Done(); cancelled <- struct{}{} }))
	defer server.Close()
	h := New(server.Client())
	in, _ := json.Marshal(input{URL: server.URL, Operation: "search", Query: "x", TimeoutMS: 20})
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("POST", "/v1/cms", strings.NewReader(string(in))))
	if w.Code != 504 {
		t.Fatal(w.Code)
	}
	select {
	case <-cancelled:
	case <-time.After(time.Second):
		t.Fatal("upstream not cancelled")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("POST", "/v1/cms", strings.NewReader(string(in))).WithContext(ctx))
	if w.Code != 504 {
		t.Fatal(w.Code)
	}
}
