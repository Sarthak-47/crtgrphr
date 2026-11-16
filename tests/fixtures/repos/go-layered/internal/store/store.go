package store

import (
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

func Open() (*pgxpool.Pool, *redis.Client) { return nil, nil }
