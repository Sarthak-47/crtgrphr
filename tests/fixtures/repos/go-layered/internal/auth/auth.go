package auth

import "github.com/acme/shop/internal/store"

func Check() { store.Open() }
