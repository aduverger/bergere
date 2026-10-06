.PHONY: start stop status logs build

start:
	node --import tsx scripts/server.ts start

stop:
	node --import tsx scripts/server.ts stop

status:
	node --import tsx scripts/server.ts status

logs:
	tail -n 100 -f .run/server.log

build:
	pnpm build
