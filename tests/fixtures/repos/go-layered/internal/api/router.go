package api

import (
	"github.com/gin-gonic/gin"

	"github.com/acme/shop/internal/auth"
	"github.com/acme/shop/internal/store"
	// "github.com/acme/shop/pkg/logx" is not imported here
)

var doc = `import "github.com/acme/shop/pkg/logx"`

func Run() error { r := gin.New(); _ = auth.Check; _ = store.Open; return r.Run() }
