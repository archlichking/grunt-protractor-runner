/*
 * grunt-protractor-runner
 * https://github.com/teerapap/grunt-protractor-runner
 *
 * Copyright (c) 2013 Teerapap Changwichukarn
 * Licensed under the MIT license.
 */

'use strict';

var util = require('util');
var path = require('path');
var fs = require('fs');
var split = require('split');
var through2 = require('through2');
var q = require('q');
var fs = require('fs');
var _ = require('lodash');
var sauceConnectLauncher = require('sauce-connect-launcher');

module.exports = function(grunt) {

  grunt.registerMultiTask('protractor', 'A grunt task to run protractor.', function() {
    var retryQueue = [];
    var specs = [];
    var retriedSpecs = {};
    var counter = {};

    // sauce
    var port = 14796 + Math.floor(Math.random() * 100) + 1;

    // shouldnt do this but let's add prefix
    var w2g_sauceConnector = null;
    var w2g_scTunnelIdentifier = 'w2g_deploy_' + port;
    var w2g_scPort = port;


    // '.../node_modules/protractor/lib/protractor.js'
    var protractorMainPath = require.resolve('protractor');
    // '.../node_modules/protractor/bin/protractor'
    var protractorBinPath = path.resolve(protractorMainPath, '../../bin/protractor');
    // '.../node_modules/protractor/referenceConf.js'
    var protractorRefConfPath = path.resolve(protractorMainPath, '../../referenceConf.js');

    // Merge task-specific and/or target-specific options with these defaults.
    var opts = this.options({
      configFile: protractorRefConfPath,
      keepAlive: false,
      noColor: false,
      debug: false,
      nodeBin: 'node',
      args: {},
      output: false,
      retry: 0,
      saucelab: {
        launcher: false,
        sauceUser: null,
        sauceKey: null,
        saucePort: null
      }
    });

    // configFile is a special property which need not to be in options{} object.
    if (!grunt.util._.isUndefined(this.data.configFile)) {
      opts.configFile = this.data.configFile;
    }

    grunt.verbose.writeln("Options: " + util.inspect(opts));

    var keepAlive = opts['keepAlive'];
    var strArgs = ["seleniumAddress", "seleniumServerJar", "seleniumPort", "baseUrl", "rootElement", "browser", "chromeDriver", "chromeOnly", "directConnect", "sauceUser", "sauceKey", "sauceSeleniumAddress", "framework", "suite"];
    var listArgs = ["specs", "exclude"];
    var boolArgs = ["includeStackTrace", "verbose"];
    var objectArgs = ["params", "capabilities", "cucumberOpts", "mochaOpts"];

    var args = process.execArgv.concat([protractorBinPath, opts.configFile]);
    if (opts.noColor) {
      args.push('--no-jasmineNodeOpts.showColors');
    }
    if (!grunt.util._.isUndefined(opts.debug) && opts.debug === true) {
      args.splice(1, 0, 'debug');
    }

    // Iterate over all supported arguments.
    strArgs.forEach(function(a) {
      if (a in opts.args || grunt.option(a)) {
        args.push('--' + a, grunt.option(a) || opts.args[a]);
      }
    });

    listArgs.forEach(function(a) {
      if (a in opts.args || grunt.option(a)) {
        if (a === 'specs') {
          var specFiles = fs.readdirSync(opts.args[a]);
          specs = grunt.option(a) || _.map(specFiles, function(n) {
            return opts.args[a] + '/' + n;
          }).join(",");
          // args.push('--' + a, grunt.option(a) || sf.join(","));
        } else {
          args.push('--' + a, grunt.option(a) || opts.args[a].join(","));
        }


      }
    });
    boolArgs.forEach(function(a) {
      if (a in opts.args || grunt.option(a)) {
        args.push('--' + a);
      }
    });

    // Convert [object] to --[object].key1 val1 --[object].key2 val2 ....
    objectArgs.forEach(function(a) {
      (function convert(prefix, obj, args) {
        for (var key in obj) {
          var val = obj[key];
          var type = typeof obj[key];
          if (type === "object") {
            if (Array.isArray(val)) {
              // Add duplicates --[object].key val1 --[object].key val2 ...
              for (var i = 0; i < val.length; i++) {
                args.push(prefix + "." + key, val[i]);
              }
            } else {
              // Dig deeper
              convert(prefix + "." + key, val, args);
            }
          } else if (type === "undefined" || type === "function") {
            // Skip these types
          } else if (type === "boolean") {
            // Add --[object].key
            args.push(prefix + "." + key);
          } else {
            // Add --[object].key value
            args.push(prefix + "." + key, val);
          }
        }
      })("--" + a, opts.args[a], args);
    });

    grunt.verbose.writeln("Spawn node with arguments: " + args.join(" "));

    // Spawn protractor command
    var done = this.async();


    var promiseCb = function(specFile) {
      return function() {
        var vargs = _.clone(args);
        vargs.push('--specs', specFile);

        var cmd = {
          cmd: opts.nodeBin,
          args: vargs,
          opts: {
            stdio: 'pipe'
          }
        };

        var def = q.defer();

        var child = grunt.util.spawn(cmd, function(err, result, code) {

          // console.log(err, code, retryQueue, retriedSpecs, opts.retry, specFile)
          if (err) {
            grunt.log.error(String(result));
            if (code === 1 && keepAlive) {
              // Test fails but do not want to stop the grunt process.
              grunt.log.oklns("Test failed but keep the grunt process alive.");
              if (opts.retry) {
                if (!retriedSpecs[specFile]) {
                  retriedSpecs[specFile] = 0;
                }

                if (retriedSpecs[specFile] < opts.retry) {
                  console.log(retriedSpecs[specFile], opts.retry)
                    // retryQueue.push(specFile);
                    // retry is one and not meet the maximum attempt
                    // increase retry attempt
                  retriedSpecs[specFile] += 1;
                  def.resolve(true, specFile);
                } else {
                  def.resolve(specFile);
                }

              } else {
                def.resolve(specFile);
              }

            } else {
              grunt.fail.fatal('protractor exited with code: ' + code, 3);
              def.resolve(specFile);
            }
          } else {
            def.resolve(specFile);
          }
        });


        process.stdin.pipe(child.stdin);
        child.stdout.pipe(process.stdout);
        child.stderr.pipe(process.stderr);
        // Write the result in the output file
        if (!grunt.util._.isUndefined(opts.output) && opts.output !== false) {

          grunt.log.writeln("Output test result to: " + opts.output);

          grunt.file.mkdir(path.dirname(opts.output));

          child.stdout
            .pipe(split())
            .pipe(through2(function(chunk, encoding, callback) {
              if ((/^Using the selenium server at/).test(chunk.toString())) {
                // skip
              } else {
                this.push(chunk + '\n');
              }
              callback();
            }))
            .pipe(fs.createWriteStream(opts.output));
        }
        return def.promise;
      }
    }

    // build protractor cmd per spec
    specs.split(',').forEach(function(spec) {
      // init queue
      retryQueue.push(spec);
      counter[spec] = true;
    });

    var chain = q();

    if (opts.saucelab && opts.saucelab.launcher === true) {
      console.log('launch sauce')
        // launch as saucelabs
        // TODO: finish it
      chain = chain
        .then(function() {
          var def = q.defer();

          // use port 14796 to avoid conflict the default
          sauceConnectLauncher({
            username: opts.saucelab.sauceUser,
            accessKey: opts.saucelab.sauceKey,
            verbose: true,
            port: opts.saucelab.saucePort,
            tunnelIdentifier: w2g_scTunnelIdentifier,
            readyFileId: w2g_scTunnelIdentifier
          }, function(err, sauceConnectProcess) {
            def.resolve(sauceConnectProcess);
          });

          return def.promise;
        })
        .then(function(sauceConnectProcess) {
          w2g_sauceConnector = sauceConnectProcess;
        });
    }



    var reChain = function(chain, spec) {
      return chain
        .then(promiseCb(spec))
        .then(function(specFile) {
          if (specFile === true) {
            // retry the chain
            console.log('-----------------------------> push', spec, 'back to queue');
            return reChain(chain, spec);
          } else {
            // succeed or end test
            delete counter[spec];
            if (_.size(counter) === 0) {
              // end up grunt process
              // end up sauce connector
              if (opts.saucelab && opts.saucelab.launcher === true) {
                chain
                  .then(function() {

                    // if connected to saucelabs
                    if (w2g_sauceConnector) {
                      var def = q.defer();
                      w2g_sauceConnector.close(def.resolve);

                      return def.promise;
                    }
                  })
                  .then(function() {
                    done();
                  });
              } else {
                done();
              }

            }
          }
        });
    };

    while (retryQueue.length > 0) {
      var cmd = retryQueue.shift();
      console.log('-----------------------------> push', cmd, 'to queue');
      chain = reChain(chain, cmd);
    }

  });

};