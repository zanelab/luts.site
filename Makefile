.PHONY: build serve clean config validate-luts

config:
	@./script/build-config.sh

validate-luts:
	@./script/validate-luts.sh

build: config validate-luts
	@bundle exec jekyll build

serve: config validate-luts
	@bundle exec jekyll serve --livereload

clean:
	@rm -rf _site
	@rm -f assets/js/supabase-config.js
