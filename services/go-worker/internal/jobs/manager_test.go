package jobs

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func invoke(t *testing.T, m *Manager, input map[string]any) (int, map[string]any) {
	t.Helper()
	data, _ := json.Marshal(input)
	w := httptest.NewRecorder()
	m.ServeHTTP(w, httptest.NewRequest("POST", "/v1/jobs", strings.NewReader(string(data))))
	var result map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	return w.Code, result
}

func TestLeaseSurvivesRestartAndFencesWrongToken(t *testing.T) {
	dir := t.TempDir()
	m, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}
	status, job := invoke(t, m, map[string]any{"action": "acquire", "scope": "openlist-refresh", "payload": map[string]any{"progress": map[string]int{"current": 2, "total": 4}}})
	if status != 200 {
		t.Fatal(status, job)
	}
	if _, err = New(dir); err == nil {
		t.Fatal("allowed simultaneous store owner")
	}
	if err = m.Close(); err != nil {
		t.Fatal(err)
	}
	m, err = New(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close()
	status, read := invoke(t, m, map[string]any{"action": "get", "id": job["id"]})
	if status != 200 || read["token"] != nil || read["status"] != "running" || read["payload"] == nil {
		t.Fatal(status, read)
	}
	status, _ = invoke(t, m, map[string]any{"action": "complete", "id": job["id"], "token": "wrong"})
	if status != 409 {
		t.Fatal(status)
	}
	status, _ = invoke(t, m, map[string]any{"action": "acquire", "scope": "openlist-refresh"})
	if status != 409 {
		t.Fatal(status)
	}
	status, _ = invoke(t, m, map[string]any{"action": "complete", "id": job["id"], "token": job["token"]})
	if status != 200 {
		t.Fatal(status)
	}
	status, _ = invoke(t, m, map[string]any{"action": "renew", "id": job["id"], "token": job["token"]})
	if status != 409 {
		t.Fatal("completed lease renewed", status)
	}
}

func TestExpiredExecutorCannotRenewOrComplete(t *testing.T) {
	m, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close()
	now := time.Now()
	m.now = func() time.Time { return now }
	_, job := invoke(t, m, map[string]any{"action": "acquire", "scope": "cron", "cooldown": 600000})
	now = now.Add(leaseDuration + time.Second)
	status, read := invoke(t, m, map[string]any{"action": "get", "id": job["id"]})
	if status != 200 || read["status"] != "failed" {
		t.Fatal(status, read)
	}
	for _, action := range []string{"renew", "complete"} {
		status, _ = invoke(t, m, map[string]any{"action": action, "id": job["id"], "token": job["token"]})
		if status != 409 {
			t.Fatal(action, status)
		}
	}
	status, _ = invoke(t, m, map[string]any{"action": "acquire", "scope": "cron", "cooldown": 600000})
	if status != 409 {
		t.Fatal("lost durable cooldown", status)
	}
	now = now.Add(10 * time.Minute)
	status, _ = invoke(t, m, map[string]any{"action": "acquire", "scope": "cron", "cooldown": 600000})
	if status != 200 {
		t.Fatal(status)
	}
}

func TestSaveFailureDoesNotAcknowledgeLease(t *testing.T) {
	m, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close()
	if err = m.root.Mkdir("jobs.json", 0700); err != nil {
		t.Fatal(err)
	}
	status, _ := invoke(t, m, map[string]any{"action": "acquire", "scope": "cron"})
	if status != 503 || len(m.jobs) != 0 {
		t.Fatal("acknowledged unsaved state", status, len(m.jobs))
	}
}

func TestRejectsUnknownScopeAndOversizePayload(t *testing.T) {
	m, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close()
	status, _ := invoke(t, m, map[string]any{"action": "acquire", "scope": "http://arbitrary-callback"})
	if status != 400 {
		t.Fatal(status)
	}
	status, _ = invoke(t, m, map[string]any{"action": "acquire", "scope": "cron", "payload": strings.Repeat("x", 65537)})
	if status != 413 {
		t.Fatal(status)
	}
}
