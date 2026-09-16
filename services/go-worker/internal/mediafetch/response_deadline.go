package mediafetch

import (
	"net/http"
	"time"
)

// finiteResponseWriter starts a socket write budget only when output is ready.
// It never resets the budget between writes and is not used for local media streams.
type finiteResponseWriter struct {
	http.ResponseWriter
	started bool
}

func (w *finiteResponseWriter) begin() {
	if !w.started {
		w.started = true
		_ = http.NewResponseController(w.ResponseWriter).SetWriteDeadline(time.Now().Add(10 * time.Second))
	}
}
func (w *finiteResponseWriter) WriteHeader(status int) {
	w.begin()
	w.ResponseWriter.WriteHeader(status)
}
func (w *finiteResponseWriter) Write(p []byte) (int, error) {
	w.begin()
	return w.ResponseWriter.Write(p)
}
func (w *finiteResponseWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }
