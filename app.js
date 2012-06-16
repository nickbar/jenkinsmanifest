
/**
 * Module dependencies.
 */

var express = require('express')
  , routes = require('./routes')


var express = require('express');
var http = require('http');
var url = require('url');
var collections = require('./collections');

var app = module.exports = express.createServer();

var get = function(urlStr, callback) {
 var u = url.parse(urlStr);
 http.get({ host: u.host, port: u.port, path: u.pathname + (u.search ? u.search : ''), headers: {'Accept': '*/*', 'User-Agent': 'curl'} },
   function(res) {
     var data = '';
     res.on('data', function(chunk) {
       data += chunk;
     }).on('end', function() {
       try {
         callback(null, data);
       }
       catch (err) {
         console.log('exception during get of ' + urlStr);
         console.log(err);
         callback(err);
       }
     });
   }).on('error', function(error){
     console.log('error during get');
     console.log(error);
     callback(error);
   });
}

var ajax = function(urlStr, callback) {
  get(urlStr, function(err, data) {
    if (err)
      callback(err);
    else
      callback(err, JSON.parse(data));
  })
}

// Configuration

app.configure(function(){
  app.set('views', __dirname + '/views');
  app.set('view engine', 'jade');
  app.use(express.bodyParser());
  app.use(express.methodOverride());
  app.use(app.router);
  app.use(express.static(__dirname + '/public'));
});

app.configure('development', function(){
  app.use(express.errorHandler({ dumpExceptions: true, showStack: true })); 
});

app.configure('production', function(){
  app.use(express.errorHandler()); 
});

// Routes

var manifest;
var history;

function purger() {
  manifest = {
    version: 1,
    homepage: "http://www.cyanogenmod.com/",
    donate: "https://www.paypal.com/cgi-bin/webscr?cmd=_s-xclick&hosted_button_id=3283920",
    roms: [
    ]
  }
  
  history = {};
  
  setTimeout(purger, 30 * 60 * 1000);
}
purger();

app.get('/manifest', function(req, res) {
  res.header('Cache-Control', 'max-age=300');
  res.send(manifest);
});

function getTrimmed(req, filter) {
  var device = req.params.device;
  var trimmed = {
    version: 1,
    homepage: "http://www.cyanogenmod.com/",
    donate: "https://www.paypal.com/cgi-bin/webscr?cmd=_s-xclick&hosted_button_id=3283920",
    roms: [
    ]
  };
  
  collections.each(manifest.roms, function(index, rom) {
    if (rom.device == device) {
      if (!filter || filter(rom))
        trimmed.roms.push(rom);
    }
  });
  return trimmed;
}

app.get('/manifest/release', function(req, res) {
  res.header('Cache-Control', 'max-age=300');
  var trimmed = {
    version: 1,
    homepage: "http://www.cyanogenmod.com/",
    donate: "https://www.paypal.com/cgi-bin/webscr?cmd=_s-xclick&hosted_button_id=3283920",
    roms: [
    ]
  };
  
  collections.each(manifest.roms, function(index, rom) {
    var build = history[rom.build];
    if (build.type == req.params.category)
      trimmed.roms.push(rom);
  });
  res.send(trimmed);
});



app.get('/manifest/:device', function(req, res) {
  res.header('Cache-Control', 'max-age=300');
  var trimmed = getTrimmed(req);
  
  res.send(trimmed);
});

function useOnlyLatest(trimmed) {
  var latest = null;
  var latestBuild = 0;
  collections.each(trimmed.roms, function(index, rom) {
    if (!latest || latest.build < rom.build) {
      latest = rom;
    }
  });
  
  trimmed.roms = [];
  if (latest)
    trimmed.roms.push(latest);
}

app.get('/manifest/:device/latest', function(req, res) {
  res.header('Cache-Control', 'max-age=300');
  var trimmed = getTrimmed(req);

  useOnlyLatest(trimmed);
  res.send(trimmed);
});

app.get('/manifest/:device/:category', function(req, res) {
  res.header('Cache-Control', 'max-age=300');
  var trimmed = getTrimmed(req, function(rom) {
    var build = history[rom.build];
    if (build.type == req.params.category)
      return true;
  });
  
  res.send(trimmed);
});


app.get('/manifest/:device/:category/latest', function(req, res) {
  res.header('Cache-Control', 'max-age=300');
  var trimmed = getTrimmed(req, function(rom) {
    var build = history[rom.build];
    if (build.type == req.params.category)
      return true;
  });
  
  useOnlyLatest(trimmed);
  res.send(trimmed);
});

if (typeof String.prototype.startsWith != 'function') {
  String.prototype.startsWith = function (str){
    return this.indexOf(str) == 0;
  };
}
if (typeof String.prototype.endsWith != 'function') {
  String.prototype.endsWith = function (str){
    return this.slice(-str.length) == str;
  };
}

function refresh() {
  ajax('http://jenkins.cyanogenmod.com/job/android/api/json', function(err, data) {
    setTimeout(refresh, 300000);
    if (err)
      return;
    collections.each(data.builds, function(index, build) {
      if (history[build.number]) {
        console.log(build.number + ": already processed.");
        return;
      }
      ajax(build.url + 'api/json', function(err, data) {
        if (err) {
          console.log('error processing: ' + build.number)
          console.log(err)
          return;
        }
        var found = false;
        var entry = {
        };
        var zip;
        var buildData;
        collections.each(data.artifacts, function(index, artifact) {
          if ((artifact.displayPath.startsWith('cm-') || artifact.displayPath.startsWith('update-')) && artifact.displayPath.endsWith('.zip')) {
            zip = artifact.displayPath;
            entry.url = 'http://get.cm/get/artifacts/' + build.number + '/artifact/archive/' + artifact.displayPath;
            return;
          }
          
          if (artifact.displayPath != 'build.prop')
            return;

          found = true;
          ajax(build.url + 'api/json', function(err, data) {
            buildData = data;
            if (err)
              return;
            if (data.result != 'SUCCESS') {
              if (data.result != null) {
                history[build.number] = build;
              }
              else {
                console.log(build.number + ": in progress");
              }
              return;
            }
            
            if (data.building || data.duration == 0) {
              console.log(build.number + ": finished building, but is still archiving");
              return;
            }
            
            if (data.timestamp + data.duration + 10 * 60 * 1000 > Date.now()) {
              console.log(build.number + ": must wait 10 minutes before exposing build to fix hacky race condition with nginx reverse proxy");
            }

            get(build.url + 'artifact/archive/build.prop', function(err, data) {
              if (err)
                return;
              history[build.number] = buildData;
              var lines = data.split('\n');
              var version;
              collections.each(lines, function(index, line) {
                var pair = line.split('=', 2);
                if (pair.length != 2)
                  return;
                var key = pair[0];
                var value = pair[1];
                if (key == 'ro.modversion') {
                  entry.modversion = value;
                  version = value.split('-');
                  version.pop();
                  if (!value.startsWith('CyanogenMod-')) {
                    version.pop();
                  }
                  entry.name = 'CyanogenMod ' + version.join(' ');
                  entry.name = entry.name.replace('CyanogenMod CyanogenMod', 'CyanogenMod');
                  entry.incremental = build.number;
                }
                if (key == 'ro.cm.device')
                  entry.device = value;

              });

              if (entry.device && entry.incremental) {
                buildData.zip = zip;
                entry.build = build.number;
                console.log(build.number + ": " + entry.url);
                entry.summary = 'Build: ' + version[1];
                manifest.roms.push(entry);
                manifest.roms = collections.sort(manifest.roms, function(r) {
                  return r.incremental;
                });
                manifest.roms.reverse();
                collections.each(buildData.actions, function(index, p) {
                  if (p.parameters) {
                    collections.each(p.parameters, function(index, p) {
                      if (p.name == 'RELEASE_TYPE') {
                        entry.product = buildData.type = p.value;

                        if (entry.modversion.startsWith('9-') != -1) {
                          entry.addons = [
                              {
                                  "name": "Google Apps",
                                  "url": "http://download2.clockworkmod.com/gapps/gapps-ics-20120429-signed.zip"
                              }
                          ]
                        }
                        else {
                          entry.addons = [
                          {
                              "name": "Google Apps",
                              "url": "http://download2.clockworkmod.com/gapps/gapps-gb-20110828-signed.zip"
                          },
                          {
                              "name": "GTalk w/ Video Chat (Experimental!)",
                              "url": "http://download2.clockworkmod.com/gapps/gapps-gb-20110828-newtalk-signed.zip"
                          }
                          ]
                        }
                      }
                    });
                  }
                });
              }
              else {
                history[build.number] = build;
                console.log(build.number + ": missing build.prop entries");
              }
            });

          });
        });
        if (!found) {
          console.log(build.number + ": missing artifacts");
          history[build.number] = data;
          return;
        }
      });
    });
  });
}

refresh();

function renderList(req, res, currentDevice, currentType) {
  var devices = {};
  collections.each(manifest.roms, function(index, rom) {
    devices[rom.device] = true;
  });
  
  devices = Object.keys(devices);
  collections.sort(devices, function(d) {
    return d;
  });
  
  collections.sort(manifest.roms, function(v) {
    return v.build;
  });
  
  manifest.roms.reverse();
  
  var trimmed = {
    version: 1,
    homepage: "http://www.cyanogenmod.com/",
    donate: "https://www.paypal.com/cgi-bin/webscr?cmd=_s-xclick&hosted_button_id=3283920",
    roms: [
    ]
  };
  if (currentType && currentType != 'all') {
    collections.each(manifest.roms, function(index, rom) {
      if (history[rom.build].type == currentType)
        trimmed.roms.push(rom);
    });
  }
  else {
    trimmed = manifest;
  }
  
  res.render('index', {
    currentType: currentType == null ? 'all' : currentType,
    currentDevice: currentDevice == null ? 'all' : currentDevice,
    devices: devices,
    manifest: trimmed,
    history: history
  });
}

app.get('/', function(req, res) {
  renderList(req, res);
});

app.get('/device/:device', function(req, res) {
  renderList(req, res, req.params.device);
});

app.get('/device/:device/:type', function(req, res) {
  renderList(req, res, req.params.device, req.params.type);
});

var listenPort = process.env.PORT == null ? 3000 : parseInt(process.env.PORT);
app.listen(listenPort);
console.log('Express app started on port ' + listenPort);

