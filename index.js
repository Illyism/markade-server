#!/usr/bin/env node
var connect = require('connect'),
	colors = require('colors'),
	WebSocket = require('faye-websocket'),
	path = require('path'),
	url = require('url'),
	http = require('http'),
	send = require('send'),
	open = require('open'),
	es = require("event-stream"),
	watchr = require('watchr'),
	ws;

var INJECTED_CODE = require('fs').readFileSync(__dirname + "/injected.html", "utf8");

var LiveServer = {};

function escape(html){
	return String(html)
		.replace(/&(?!\w+;)/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

// Based on connect.static(), but streamlined and with added code injecter
function staticServer(root) {
	return function(req, res, next) {
		if ('GET' != req.method && 'HEAD' != req.method) return next();
		var reqpath = url.parse(req.url).pathname;

		function directory() {
			var pathname = url.parse(req.originalUrl).pathname;
			res.statusCode = 301;
			res.setHeader('Location', pathname + '/');
			res.end('Redirecting to ' + escape(pathname) + '/');
		}

		function error(err) {
			if (404 == err.status) return next();
			next(err);
		}

		function inject(stream) {
			var x = path.extname(reqpath);
			if (x === "" || x == ".html" || x == ".htm" || x == ".xhtml" || x == ".php") {
				// We need to modify the length given to browser
				var len = INJECTED_CODE.length + res.getHeader('Content-Length');
				res.setHeader('Content-Length', len);

				var originalPipe = stream.pipe;
				stream.pipe = function(res) {
					originalPipe.call(stream, es.replace(new RegExp("</body>","i"), INJECTED_CODE + "</body>")).pipe(res);
				};
			}
		}

		send(req, reqpath, { root: root })
			.on('error', error)
			.on('stream', inject)
			.on('directory', directory)
			.pipe(res);
	};
}

/**
 * Start a live server at the given port and directory
 * @param port {number} Port number (default 8080)
 * @param baseDirectory {string} Path to root directory (default to cwd)
 * @param directory {string} Path to root directory (default to cwd)
 * @param suppressBrowserLaunch
 */
LiveServer.start = function(port, baseDirectory, publicDirectory, suppressBrowserLaunch) {
	port = port || 8080;
	baseDirectory = baseDirectory || process.cwd();
	publicDirectory = publicDirectory || path.resolve(process.cwd(), "public");

	// Setup a web server
	var app = connect()
		.use(staticServer(publicDirectory)) // Custom static server
		.use(connect.directory(publicDirectory, { icons: true }))
		.use(connect.logger('dev'));
	var server = http.createServer(app).listen(port, '0.0.0.0');
	// WebSocket
	server.addListener('upgrade', function(request, socket, head) {
		ws = new WebSocket(request, socket, head);
		ws.onopen = function() { ws.send('connected'); };
	});
	// Setup file watcher
	watchr.watch({
		path: baseDirectory,
		ignoreCommonPatterns: true,
		ignoreHiddenFiles: true,
		preferredMethods: [ 'watchFile', 'watch' ],
		interval: 1407,
		listeners: {
			error: function(err) {
				console.log("ERROR:".red , err)
			},
			change: function(eventName, filePath, fileCurrentStat, filePreviousStat) {
				if (!ws) return;
				if (path.extname(filePath) == ".css") {
					ws.send('refreshcss');
					console.log("CSS change detected");
				} else if (path.extname(filePath) == ".jade") {
					console.log("Jade change detected".cyan);
					if (LiveServer.change) LiveServer.change(filePath);
				} else if (path.extname(filePath) == ".md") {
					console.log("Markdown change detected".cyan);
					if (LiveServer.change) LiveServer.change(filePath);
				} else {
					ws.send('reload');
					console.log("File change detected");
				}
			}
		}
	});
	// Output
	console.log(('Serving "' + baseDirectory + '" at http://0.0.0.0:' + port).green);

	// Launch browser
	if(!suppressBrowserLaunch)
		open('http://localhost:' + port);
}

module.exports = LiveServer;
