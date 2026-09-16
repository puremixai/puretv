//go:build linux || darwin || freebsd || openbsd || netbsd || dragonfly

package filelock

import (
	"os"
	"syscall"
)

func Lock(file *os.File) error { return syscall.Flock(int(file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB) }
