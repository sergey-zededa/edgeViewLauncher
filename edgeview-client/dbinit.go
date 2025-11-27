// nolint
package main

import (
	"github.com/zededa/zedcloud/libs/database"
)

var (
	dbcx database.DBClient
)

func InitAllDBs(dbctx database.DBClient) error {
	dbcx = dbctx
	return nil
}
