//go:build linux

package localfiles

import (
	"os"
	"syscall"
)

// O_NONBLOCK also prevents a concurrent regular-file-to-FIFO replacement from hanging Open.
func openFile(root *os.Root, name string) (*os.File, error) {
	return root.OpenFile(name, os.O_RDONLY|syscall.O_NONBLOCK, 0)
}
