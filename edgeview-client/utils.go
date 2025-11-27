package main

import (
	"github.com/zededa/zedcloud/libs/edgeview"
)

// nolint:gochecknoglobals
var (
	netopts        []string
	sysopts        []string
	clientStateMap = make(map[string]map[int]*edgeview.ClientState)
	evtcpMapping   = make(map[string]int)
)

// initOpts initializes the supported options for different categories
func initOpts() {
	netopts = edgeview.OptionLists[edgeview.NetworkOption]
	sysopts = edgeview.OptionLists[edgeview.SystemOption]
}
