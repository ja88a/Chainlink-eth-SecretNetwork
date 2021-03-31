check?=schedule

docker:
	docker build --build-arg module=$(module) --build-arg name=$(name) -f Dockerfile . -t $(repo)$(if $(name),$(name),$(module))-module $(if $(tag), -t $(repo)$(tag), )

zip: deps build
	(cd $(module)/dist && zip $(if $(name),$(name),$(module))-module.zip index.js)

new:
	mkdir $(module)
	cp -R example/* $(module)
	# cp -R will not copy hidden & special files, so we copy manualy
	cp example/.eslintrc.js $(module)
	cat package.json \
	  | jq '.workspaces += ["$(module)"]' \
	  | tee package.json > /dev/null
	cat .github/strategy/modules.json \
	  | jq '.modules.module += ["$(module)"]' \
	  | tee .github/strategy/modules.json > /dev/null
	cat $(module)/package.json \
	  | jq '.name = "@chainlink/$(module)-module" | .description = "Chainlink $(module) module." | .keywords += ["$(module)"]' \
	  | tee $(module)/package.json > /dev/null
	sed -i 's/Example/$(module)/' $(module)/README.md

clean:
	rm -rf $(module)/dist

deps: clean
	# Restore all dependencies
	yarn
	# Call the build script for the module if defined (TypeScript modules have this extra build/compile step)
	# We use `wsrun` to build workspace dependencies in topological order (TODO: use native `yarn workspaces foreach -pt run setup` with Yarn 2)
	yarn wsrun -mre -p @chainlink/ea-bootstrap -t setup
	yarn wsrun -mre -p @chainlink/ea-factories -t setup
	yarn wsrun -mre -p @chainlink/external-module -t setup
	yarn wsrun -mre -p @chainlink/$(if $(name),$(name),$(module))-module -t setup
	yarn --frozen-lockfile --production

build:
	npx @vercel/ncc@0.25.1 build $(module) -o $(module)/dist

clean-2-step:
	rm -rf 2-step/$(module)

build-2-step:
	cp -r $(module) 2-step/
	if [ -f "2-step/$(module)/dist/module.js" ]; then \
		mv 2-step/$(module)/dist/module.js 2-step/$(module)/pricemodule.js; \
	else mv 2-step/$(module)/module.js 2-step/$(module)/pricemodule.js; \
	fi
	cp 2-step/module.js 2-step/$(module)
	cp -r helpers 2-step/helpers
	npx @vercel/ncc@0.25.1 build 2-step/$(module) -o 2-step/$(module)/dist
	rm 2-step/$(module)/pricemodule.js
	rm 2-step/$(module)/module.js

docker-2-step:
	docker build --no-cache --build-arg module=$(module) -f Dockerfile-2Step . -t $(repo)$(module)-2-step-module

zip-2-step: deps clean-2-step build-2-step
	(cd 2-step/$(module)/dist && zip $(module)-2-step-module.zip index.js)
