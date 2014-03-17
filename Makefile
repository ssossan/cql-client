MOCHA=./node_modules/mocha/bin/_mocha
ISTANBUL=./node_modules/.bin/istanbul

test:
	$(MOCHA) -R spec test/*.js

test-cov: clean
	$(ISTANBUL) cover $(MOCHA) -- -R spec test/*.js

coveralls:
	cat ./coverage/lcov.info | ./node_modules/coveralls/bin/coveralls.js;

clean:
	rm -rf coverage
