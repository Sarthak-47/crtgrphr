// Command server runs the API.
package main

import (
	"log"

	"github.com/acme/shop/internal/api"
	cfg "github.com/acme/shop/pkg/logx"
)

func main() {
	cfg.Setup()
	log.Fatal(api.Run())
}
