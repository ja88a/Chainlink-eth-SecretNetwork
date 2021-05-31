check?=schedule

bootstrap:
	BUILD_LIBRDKAFKA=0 lerna bootstrap 
	lerna link
	lerna run build

docker:
	docker build --build-arg module=$(module) --build-arg name=$(name) -f Dockerfile . -t $(repo)$(if $(name),$(name),$(module))-module $(if $(tag), -t $(repo)$(tag), )

zip: deps build
	(cd $(module)/dist && zip $(if $(name),$(name),$(module))-module.zip index.js)

clean:
	lerna run clean
	
reset:
	lerna run reset
	yarn reset

deps: clean
	# Restore all dependencies
	BUILD_LIBRDKAFKA=0 yarn
	lerna 
	yarn --frozen-lockfile --production

build:
	lerna run build
