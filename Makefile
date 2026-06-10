.PHONY: build serve clean config

config:
	@./script/build-config.sh

build: config
	@bundle exec jekyll build

serve: config
	@bundle exec jekyll serve --livereload

clean:
	@rm -rf _site
	@rm -f assets/js/supabase-config.js
