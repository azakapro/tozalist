// Command engine is the internal validation engine for TozaList.
//
// TRUST BOUNDARY: this process is internal-only. It is never published to the
// host and must never be reachable from the public internet. See
// docs/architecture.md.
//
// Scope note (step 0.1): placeholder process. It logs that it is up and stays
// alive until Docker Compose (or an operator) terminates it. No HTTP server and
// no validation logic exist yet.
package main

import (
	"log"
	"os"
	"os/signal"
	"syscall"
)

func main() {
	log.SetFlags(0)
	log.Println("engine placeholder")

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	sig := <-stop
	log.Printf("engine shutting down: %s", sig)
}
