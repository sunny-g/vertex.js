var http = require('http');
var fs = require('fs');

require("./Log");
require("./Timer");
require("./IdleMonitor");
require("./AddonLoader");
require("./Collector");
require("./PNode");
require("./PCursor");
require("./PDB");
require("./PRecord");
require("./PUser");

Vertex = Proto.clone().newSlots({
	protoType: "Vertex",
	pdb: null,
	path: "db/vertex.vdb",
	delegates: [],
	port: 8000,
	delegate: null,
	lastReqTime: null,
	idleMonitor: null,
	timer: null,
	isRunning: false,
	idleTimer: null,
	requestCount: 0,
	syncTimerId: null,
	syncTimerDate: null,
	user: null,
	currentRequest: null,
	currentResponse: null,
	verbose: false,
	addons: null
}).setSlots({
	init: function()
	{
		this._pdb = PDB.clone()
		this.setDelegates([]);
		var self = this;
		this.setIdleTimer(
			Timer.clone().setDt(.1).setCallback(function () { self.idleTimerCallback(); })
		)
		this.setUser(PUser.clone()).setPdb(this._pdb);
		this.setAddons([]);
		return this;
	},
	
	timer: function()
	{
		if(!this._timer)
		{
			this._timer = Timer.clone();
		}
		
		return this._timer;
	},

	start: function()
	{
		writeln("");
		writeln("vertex.js:");
		writeln("  database: ", this.path());
		writeln("  port:     ", this.port());
		writeln("  status:   ready\n");

		this.open();

		this.setAddons(AddonLoader.loadAddons());
		for (var i = 0; i < this.addons().length; i ++)
		{
			var addon = this.addons()[i];
			addon.setVertex(this);
		}
		
		for (var i = 0; i < this.addons().length; i ++)
		{
			addon.conditionallyPerform("vertexLoaded");
		}
		
		var delegate = this.delegate();
		if(delegate)
		{
			if(delegate.respondsTo("vertexWillStart"))
			{
				delegate.vertexWillStart(this);
			}
		}
		
		//this.setLastReqTime(new Date().getTime());
		
		var im = IdleMonitor.clone();
		im.setVertex(this);
		im.start();

		var self = this;
		http.createServer(function(request, response)
		{
			self.handleRequest(request, response);
		}).listen(this.port());
		
		process.addListener("exit", function()
		{
			self.close();
		});
		
		this.setIsRunning(true);
	},

	open: function()
	{
		this.pdb().setPath(this.path()).open();
/*
this.show();
process.exit();
*/
		return this;
	},

	close: function()
	{
		this._pdb.commit();
		this._pdb.close();
		return this;
	},

	handleRequest: function(request, response)
	{
		var delegate = this.delegate();
		if(delegate)
		{
			delegate.vertexHandleRequest(this, request, response);
			return
		}
		
		try
		{
			request.isGet = request.method.toLowerCase() == "get";

			request.addListener('data', function(data)
			{
				if(request["body"] === undefined)
				{
					request.body = "";
				}

				request.body = request.body + data;
			});

			var self = this;
			request.addListener('end', function()
			{
				if(this._verbose) writeln("\nreceived: '" + request.body + "'");
//var start = new Date;
//Profiler.reset();
				self.simpleHandleRequest(request, response);
//Profiler.logReport();
//writeln();
//elapsed = new Date().getTime() - start.getTime();
/*
if(elapsed > 1000)
{
	Log.writeln("Long request (", elapsed, "ms) ", request.uri, "\n", request.body);
}
*/
			});
		}
		catch(e)
		{
			console.log("exception: " + e);
			response.writeError(e);
			//response.end();
		}
	},
	
	writeErrorOnResponse: function(e, response)
	{		
		//writeln("ERROR: " + JSON.stringify(e));
		this.writeResultOnResponseWithStatus(e, response, 500);
	},
	
	showStack: function(stack)
	{
		var lines = stack.split("\n");
		var body = "<body style='margin-left:7em; margin-top:6em; line-height:1.5em;'>"
		body = body + "" + "<font color=#c00>" + lines.removeAt(0) + "</font><p>";
		body = body + "<div style='padding-left:3em'>";
		
		var calls = lines.map(
			function (s) 
			{ 
				var s = s.after("at ");
				if(s)
				{
					if(s.contains("("))
					{
						var place = s.before(" (");
						var rest = s.after(" (");
						var filePath = rest.before(")").before(":");
					}
					else
					{
						var place = "";
						var filePath = s.before(":");
					}

					if(filePath == "native")
					{
						return "<tr><td></td><td></td><td>" + place + "&nbsp;&nbsp;</td></tr>";
					}
					else
					{
						var fileName = filePath.pathComponents().last().before(".");
						var line = s.between(":", ":");
						
						var url = "txmt://open/?url=file://" + filePath + "&line=" + line //"&column=" + column
						return "<tr onmouseover=\"style.backgroundColor='#ddd';style.cursor='pointer';\" onmouseout=\"style.backgroundColor='#fff';style.cursor='default';\" onclick=\"window.location = '" + url.htmlEscaped() + "'\"><td align=right><font color=#999>" + line + "&nbsp;&nbsp;</td><td>" + fileName.htmlEscaped() + "&nbsp;&nbsp;</td><td>" + place.after(".").htmlEscaped() + "&nbsp;&nbsp;</td></tr>";
					}
				}
				else
				{
					return null;
				}
			}
		).removeNulls();
		
		body = body + "<table cellspacing=0 border=0 cellpadding=2>" + calls.join("\n") + "</table>";
		body = body + "</div>";
		return body;
	},
	
	writeResultOnResponseWithStatus: function(results, response, status)
	{
		//if(this._verbose) writeln("sending: " + status + "'" + results + "'");
		var body;
		
		if(results.stack && results.message == null)
		{
			if(this._verbose) writeln(results.stack);
			
			try
			{
				body = this.showStack(results.stack);
			}
			catch(e)
			{
				body = JSON.stringify(results);
				//console.log(body);
			}
			/*
			var lines = results.stack.split("\n");
			body = "<body style='margin-left:7em; margin-top:6em; line-height:1.5em;'>"
			body = body + "" + "<font color=#c00>" + lines.removeAt(0) + "</font><p>";
			body = body + "<div style='padding-left:3em'>";
			
			var calls = lines.map(
				function (s) 
				{ 
					var s = s.after("at ");
					if(s && s.contains("("))
					{
						var place = s.before(" (");
						var obj = place.before(".");
						var method = place.after(".");
						var rest = s.after(" (");
						var path = rest.before(":").pathComponents().last();
						var line = rest.after(":").before(":");
						//return { place: place.replace("\.", " "), path:path, line: line}; 
						if ({"events.js":true, "http.js":true, "net.js":true}[path] || method == "<anonymous>") return "";
						//return "<tr><td>" + path.before(".") + "</td><td>" + method + "&nbsp;&nbsp;</td><td align=right>" + path + "</td><td>" + line + "</td></tr>"; 
						var filePath = rest.before(":");
						filePath = "txmt://open/?url=file://" + filePath + "&line=" + line //"&column=" + column
						
						return "<tr onmouseover=\"style.backgroundColor='#ddd';\" onmouseout=\"style.backgroundColor='#fff';\" onclick=\"window.location = '" + filePath + "'\"><td align=right><font color=#999>" + line + "&nbsp;&nbsp;</td><td>" + path.before(".") + "&nbsp;&nbsp;</td><td>" + method + "&nbsp;&nbsp;</td></tr>"; 

					}
					return "";
				}
			);
			
			body = body + "<table cellspacing=0 border=0 cellpadding=2>" + calls.join("\n") + "</table>";
			body = body + "</div>";
			*/
		}
		else
		{
			body = JSON.stringify(results);
	
		}
		//body = body.replaceSeq("\\n", "<br>");
		//body = "<html><body><pre>" + body + "</body></html>";

		response.writeHead(status, 
			{ 
				//"Content-Type": "application/json; charset=utf-8",
				"Content-Type": "text/html; charset=utf-8",
				"Content-Length": Buffer.byteLength(body.toString(), "utf8")
			}
		);
		response.write(body);
		response.end();
		if(this._verbose) writeln("sending: " + status + " '" + body + "'");
	},
	
	systemNodeAddon: function()
	{
		var systemNode = this.rootNode().at("System");
		if(systemNode)
		{
			var addonNode = systemNode.at("vertex-addon");
			return addonNode && addonNode.mread("data");
		}
		else
		{
			return null;
		}
	},
	
	simpleHandleRequest: function(request, response)
	{	
		var startDate = new Date;
		request.info = require('url').parse(request.url);
		if(request.info.query)
		{
			request.query = require('querystring').parse(request.info.query);
		}
		else
		{
			request.query = {};
		}
		
		var cookies = {};
		if(request.headers.cookie)
		{
			request.headers.cookie.split(';').forEach(
				function( cookie ) 
				{
					var parts = cookie.split('=');
					cookies[ parts[ 0 ].trim() ] = ( parts[ 1 ] || '' ).trim();
				}
			);
		}
		
		request.cookies = cookies;
		
		try
		{
			this.user().clear().setPdb(this._pdb);

			if (request.headers['cookie'])
			{
				this.user().setCookieHeader(request.headers['cookie']);
			}
		}
		catch (e)
		{
			writeln("error parsing cookie: " + e);
		}

		this.setCurrentRequest(request);
		this.setCurrentResponse(response);
		this._requestCount = this._requestCount + 1;


		var requestWasHandled = false;

		//writeln(JSON.stringify(request.cookies));
		var addonName = request.headers["vertex-addon"] || request.cookies["vertex-addon"] || this.systemNodeAddon();
		if(addonName)
		{
			requestWasHandled = true;
			var addon = this.addons().detect(function(addon){ return addon.addonName() == addonName });
			if(!addon)
			{
				
				this.writeErrorOnResponse(new Error("No addon named " + addonName), response);
			}
			else
			{
				this._pdb.begin();
				if(addon.handleRequest(request, response))
				{
					this._pdb.commit();
				}
			}
		}
		else if(!request.cookies["ignoreAddons"])
		{
			try 
			{
				for (var i = 0; i < this.addons().length; i ++)
				{
					var addon = this.addons()[i];
					//writeln("addon " + i + " " + addon.protoType());

					if(addon.canHandleRequest(request))
					{
						this._pdb.begin();
						if(addon.handleRequest(request, response))
						{
							requestWasHandled = true;
							//writeln("HANDLED AND COMMITTED")
							this._pdb.commit();
							break;
						}
					}	
				}
			}
			catch(e)
			{
				writeln("ADDON ERROR: " + e.message);
				writeln(e.stack);
				this.writeErrorOnResponse(e, response);
				return;
			}
			var referer = request.headers["referer"];
			if(referer)
			{
				referer = "\t" + referer;
			}
			//Log.writeln(new Date().getTime() - startDate.getTime(), "ms\t", request.url || "/", referer);
		}

		if (!requestWasHandled)
		{
			if(request.body == null)
			{
				this.writeErrorOnResponse("no json found in request", response);
				return;
			}

			try
			{
				//writeln(request.body);
				var requestItems = JSON.parse(request.body);
			}
			catch(e)
			{
				//writeln("PARSE ERROR");
				this.writeErrorOnResponse(e, response);
				return;
			}

			this._pdb.begin();

			var results;

			try
			{
				results = this.handleRequestItems(requestItems);
				this.api_sync(1);
			}
			catch(e)
			{
				//writeln("HANDLE ERROR")
				this._pdb.abort();
				this.writeErrorOnResponse(e, response);
				return;
			}

			this.writeResultOnResponseWithStatus(results, response, 200);
		}

		this.setCurrentRequest(null);
		this.setCurrentResponse(null);

		this.updateIdleTimerIfNeeded();
	},

	
	handleRequestItemsWithinCommmit: function(requestItems)
	{
		this._pdb.begin();
		var results = this.handleRequestItems(requestItems);
		this._pdb.commit();
		return results;
	},
	
	updateIdleTimerIfNeeded: function()
	{
		if(this._pdb.needsIdle())
		{
			this.idleTimer().start();
		}
		else
		{
			this.idleTimer().stop();
		}	
	},
	
	idleTimerCallback: function()
	{
		this._pdb.idle();
		this.updateIdleTimerIfNeeded()
	},
	
	handleRequestItems: function(requestItems)
	{
		var results = [];
		
		writeln(">>> ", JSON.stringify(requestItems));
		
		for (var i = 0; i < requestItems.length; i ++)
		{			
			var item = requestItems[i];
			
			if(this._verbose) { writeln("  ITEM: ", item); }
			
			try
			{
				var result = null;
				var methodName = "api_" + item.do;
			
				if(this[methodName] != null)
				{
					result = this[methodName].call(this, item);
				}
				else
				{
					if(this._verbose)  { writeln("ERROR: INVALID API '" + methodName + "'"); }
					throw {message: 'invalid api method ' + methodName};
				}
			}
			catch (e)
			{	
				if(true) //(this._verbose) 
				{
					writeln("\n");
					//writeln("  ERROR: '", JSON.stringify(e), "'");
					writeln("  ERROR: '", e.message, "'");
					writeln("  HANDLING ACTION: ", JSON.stringify(item));
					
					if(e.stack) 
					{
						writeln("  STACK: ", e.stack);
					}
					else
					{
						writeln("  NO STACK TRACE");
					}
					
					writeln("\n");
				}
				
				throw  {message: e.message, action: item, actionIndex: i, request: requestItems}
			}
			results.push(result);
		}
	//	writeln("results = ", results);
		
		writeln("<<< ", JSON.stringify(results) + "\n");
		return results;
	},

	idle: function()
	{
		this._pdb.idle();
	},

	show: function()
	{
		writeln("Vertex:");
		this.pdb().show();
	},
	
	vanish: function()
	{
		this.close();
		try 
		{ 
			fs.unlinkSync(this.path()); 
			fs.unlinkSync(this.path() + ".wal"); 
		} 
		catch(e) 
		{
		}
		
		this.pdb().vanish();
		return this;
	},
	
	rootNode: function()
	{
		return this._pdb.rootPNode();
	},
	
	node: function(pathComp)
	{
		this.assertPathIsArray(pathComp);
		return this._pdb.rootPNode().nodeAtPathComponents(pathComp, this.user());
	},
	
	validNode: function(pathComp)
	{	
		var n = this.node(pathComp, this.user());
		if(n == null)
		{
			throw {message: "invalid path"}
		}
		return n;
	},

	// API ---------------------------------
	
	assertPathIsArray: function(v)
	{
		var typeName = Object.prototype.toString.call(v);
		if(typeName === "[object Array]")
		{
			if(v[0] == "") { v = v.removeFirst(); }
			return;
		}
		throw "path is not an Array";
	},
	
	api_mk: function(dict)
	{
		this.assertPathIsArray(dict.path);
		//writeln("api_mk " + path + " USER: '" + this.user().username(), 
		//":" + this.user().password() + "' valid: " +  this.user().isValid());
	    var newPNode = this._pdb.rootPNode().createPNodeAtPathComponents(dict.path, this.user());
	
		if (newPNode) 
		{
			if (dict.meta) 
			{
				for(k in dict.meta)
				{
					newPNode.mwrite(k, dict.meta[k]);
				}
			}
		}

		return null;
	},
	
	api_rename: function(dict) //path, oldName, newName)
	{
		this.assertPathIsArray(dict.path);
		if(dict.old == dict.new) { return null; }
		
		var destNode = this.validNode(dict.path);
		if (!destNode.isWritableByUser(this.user()))
		{
			writeln("api_rename invalid write permissions");
			throw new Error("invalid write permissions");
		}
		
		destNode.rename(dict.old, dict.new);
		return null;
	},
	

	api_link: function(dict) //destPath, slotName, sourcePath)
	{
		this.assertPathIsArray(dict.dest);
		this.assertPathIsArray(dict.source);
		var destNode = this.validNode(dict.dest);
		var sourceNode = this.validNode(dict.source);

		if (!destNode.isWritableByUser(this.user()))
		{
			throw new Error("invalid write permissions")
		}
		
		destNode.link(dict.slot, sourceNode);
		return null;
	},
	
	api_ls: function(dict)
	{
		//var expressionFunc = eval(selectExpression);		
		//console.log("api_ls: " + JSON.stringify(dict.path));
		if(dict.options == null) { dict.options = {}; }
		
		var destNode = this.node(dict.path);
		if(destNode == null)
		{
			return null;
		}
			
		var c = destNode.sRecord().cursor();
		
		if(dict.options.reverse) 
		{
			console.log("api_ls: reverse");
			c.last();
		}
		else
		{
			c.first();
		}
			
		if(dict.options.start) 
		{
			console.log("api_ls: start");
			c.jump(dict.options.start);
		}
		
		var results = {};
		var max = dict.options.max;
		var count = 0;
		
		while (c.key() && (max == null || max > 0))
		{
			//if(expressionFunc(c.nodeValue()))
			//{
				if(dict.options.returnCount == null)
				{
					var inlinedNode = destNode.at(c.key());
					var mdict = inlinedNode.mRecord().slotsAsDict();
					/*
					var mdict = {};
					var mtype = inlinedNode.mread("type");
					var mview = inlinedNode.mread("view");
					if(mtype) { mdict.type = mtype; }
					if(mview) { mdict.view = mview; }
					*/
					results[c.key()] = mdict;
				}
				
				count ++;
				
				if(max) { max = max - 1; }
			//}
			
			if(dict.options.reverse)
			{
				c.prev();
			}
			else
			{
				c.next();
			}
			
		} 
		
		if(dict.options.returnCount) 
		{
			return count;
		}
		
		return results;
	},
	
	api_obj: function(dict)
	{
		var destNode = this.node(dict.path);
		if(destNode == null)
		{
			return null;
		}
			
		return destNode.asJsonObject(true);
	},
	
	api_rm: function(dict) //path, slotName)
	{
		var destNode = this.node(dict.path);
		
		if(destNode == null)
		{
			return null;
		}
		
		if (!destNode.isWritableByUser(this.user()))
		{
			throw new Error("invalid write permissions")
		}
		
		destNode.rm(dict.slot);
		return null;
	},
	
	// meta API 
	
	api_mrename: function(dict) //path, oldName, newName)
	{
		if(dict.old == dict.new) { return null; }
		
		var destNode = this.validNode(dict.path);
		if (!destNode.isWritableByUser(this.user()))
		{
			writeln("api_mrename invalid write permissions");
			throw new Error("invalid write permissions");
		}
		var r = destNode.mRecord();
		var value = r.at(dict.old);
		r.atPut(dict.new, value);
		r.removeAt(dict.old);
		return null;
	},
	
	api_mwrite: function(dict)
	{
		var destNode = this.validNode(dict.path);
		if (!destNode.isWritableByUser(this.user()))
		{
			writeln("api_mwrite invalid write permissions");
			throw new Error("invalid write permissions");
		}
		destNode.mRecord().atPut(dict.slot, dict.value);
		
		return null;
	},
	
	api_mread: function(dict) //path, name)
	{
		var destNode = this.node(dict.path);
		if(destNode == null)
		{
			return null;
		}
		
		return destNode.mRecord().at(dict.slot);
	},
	
	api_mls: function(dict)
	{
		var destNode = this.node(dict.path);
		if(destNode == null)
		{
			return null;
		}
		
		return destNode.mRecord().slotNames();
	},
	
	api_mlsread: function(dict)
	{
		var destNode = this.node(dict.path);
		if(destNode == null)
		{
			return null;
		}
		
		return destNode.mRecord().slotsAsDict();
	},
	
	api_mrm: function(dict) //path, name)
	{
		var destNode = this.validNode(dict.path);
		if (!destNode.isWritableByUser(this.user()))
		{
			throw new Error("invalid write permissions");
		}
		destNode.mrm(dict.slot);
		return null;
	},
	
	api_vanish: function()
	{
		//this.vanish().open();
		return null;
	},

	api_sync: function(dict) // dt is in seconds
	{
		var dt = new Number(dict.dt);
		
		if(dt == 0)
		{
			this._pdb.commit()
		}
		else
		{
			var self = this;
			var ms = 1000 * dt;
			var d = new Date();
			d.setTime(d.getTime() + ms);
			
			if (this._syncTimerDate == null || d < this._syncTimerDate)
			{
				if (this._syncTimerId) 
				{
					clearTimeout(this._syncTimerId);
				}
				
				this._syncTimerDate = d;
				this._syncTimerId = setTimeout(function () { self.syncTimerCallback(); }, ms);
			}
		}
		
		return null;
	},
	
	syncTimerCallback: function()
	{
		this._syncTimer = null;
		this._syncTimerDate = null;
		this._pdb.commit();
	},

	/*
	api_login: function(userName, password)
	{
		var userNode = this.validNode("/_internal/users/" .. userName)
		
		if (!userNode)
		{
			throw new Error("no such user '" + userName + "'");
		}
		
		if(userNode.password() != password)
		{
			throw new Error("wrong password");
		}
		

		var req = this.currentRequest();
		var res = this.currentResponse();
		
		this.currentResponse().setSecureCookie("vertexkey", (Math.random()*1e9).toString(36));
	},
	*/
			
	api_dbinfo: function()
	{
		return {
			requestCount: this.requestCount(),
			sizeInBytes: this._pdb.sizeInBytes(),
			collector: {
				lastStartDate: this._pdb.collector().lastStartDate(),
				lastEndDate: this._pdb.collector().lastEndDate()
			}
		}
	},
	
	api_nop: function()
	{
		return null;
	}
})//.profileMethods("simpleHandleRequest");
