"use strict";
/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Tobias Koppers @sokra
*/
const Tapable = require("tapable");
const createInnerCallback = require("./createInnerCallback");

class Resolver {
	constructor(fileSystem) {
		Tapable.call(this);
		this.fileSystem = fileSystem;
	}
}
module.exports = Resolver;

Resolver.prototype = Object.create(Tapable.prototype);

Resolver.prototype.constructor = Resolver;

Resolver.prototype.resolveSync = function resolveSync(context, path, request) {
	let err, result, sync = false;
	this.resolve(context, path, request, (e, r) => {
		err = e;
		result = r;
		sync = true;
	});
	if(!sync) throw new Error("Cannot 'resolveSync' because the fileSystem is not sync. Use 'resolve'!");
	if(err) throw err;
	return result;
};

Resolver.prototype.resolve = function resolve(context, path, request, callback) {
	if(arguments.length === 3) {
		throw new Error("Signature changed: context parameter added");
	}
	const resolver = this;
	const obj = {
		context: context,
		path: path,
		request: request
	};

	const localMissing = [];
	const missing = callback.missing ? {
		push: item => {
			callback.missing.push(item);
			localMissing.push(item);
		}
	} : localMissing;
	const log = [];
	const message = "resolve '" + request + "' in '" + path + "'";

	function writeLog(msg) {
		log.push(msg);
	}

	function logAsString() {
		return log.join("\n");
	}

	function onResolved(err, result) {
		if(callback.log) {
			for(let i = 0; i < log.length; i++)
				callback.log(log[i]);
		}
		if(err) return callback(err);
		if(!result) {
			const error = new Error("Can't " + message);
			error.details = logAsString();
			error.missing = localMissing;
			resolver.applyPlugins("no-resolve", obj, error);
			return callback(error);
		}
		return callback(null, result.path === false ? false : result.path + (result.query || ""), result);
	}
	return this.doResolve("resolve", obj, message, createInnerCallback(onResolved, {
		log: writeLog,
		missing: missing,
		stack: callback.stack
	}, null));
};

Resolver.prototype.doResolve = function doResolve(type, request, message, callback) {
	const resolver = this;
	const stackLine = type + ": (" + request.path + ") " +
		(request.request || "") + (request.query || "") +
		(request.directory ? " directory" : "") +
		(request.module ? " module" : "");
	let newStack = [stackLine];
	if(callback.stack) {
		newStack = callback.stack.concat(newStack);
		if(callback.stack.indexOf(stackLine) >= 0) {
			// Prevent recursion
			const recursionError = new Error("Recursion in resolving\nStack:\n  " + newStack.join("\n  "));
			recursionError.recursion = true;
			if(callback.log) callback.log("abort resolving because of recursion");
			return callback(recursionError);
		}
	}
	resolver.applyPlugins("resolve-step", type, request);

	resolver.applyPluginsAsyncSeriesBailResult1("before-" + type, request, createInnerCallback(beforeInnerCallback, {
		log: callback.log,
		missing: callback.missing,
		stack: newStack
	}, message && ("before " + message), true));

	function beforeInnerCallback(err, result) {
		if(arguments.length > 0) {
			if(err) return callback(err);
			if(result) return callback(null, result);
			return callback();
		}
		return resolver.applyPluginsParallelBailResult1(type, request, createInnerCallback(innerCallback, {
			log: callback.log,
			missing: callback.missing,
			stack: newStack
		}, message));
	}

	function innerCallback(err, result) {
		if(arguments.length > 0) {
			if(err) return callback(err);
			if(result) return callback(null, result);
			return callback();
		}
		return resolver.applyPluginsAsyncSeriesBailResult1("after-" + type, request, createInnerCallback(afterInnerCallback, {
			log: callback.log,
			missing: callback.missing,
			stack: newStack
		}, message && ("after " + message), true));
	}

	function afterInnerCallback(err, result) {
		if(arguments.length > 0) {
			if(err) return callback(err);
			if(result) return callback(null, result);
			return callback();
		}
		return callback();
	}
};

Resolver.prototype.parse = function parse(identifier) {
	if(identifier === "") return null;
	const part = {
		request: "",
		query: "",
		module: false,
		directory: false,
		file: false
	};
	const idxQuery = identifier.indexOf("?");
	if(idxQuery === 0) {
		part.query = identifier;
	} else if(idxQuery > 0) {
		part.request = identifier.slice(0, idxQuery);
		part.query = identifier.slice(idxQuery);
	} else {
		part.request = identifier;
	}
	if(part.request) {
		part.module = this.isModule(part.request);
		if(part.directory = this.isDirectory(part.request)) { //eslint-disable-line
			part.request = part.request.substr(0, part.request.length - 1);
		}
	}
	return part;
};

const notModuleRegExp = /^\.$|^\.[\\\/]|^\.\.$|^\.\.[\/\\]|^\/|^[A-Z]:[\\\/]/i;
Resolver.prototype.isModule = function isModule(path) {
	return !notModuleRegExp.test(path);
};

var directoryRegExp = /[\/\\]$/i;
Resolver.prototype.isDirectory = function isDirectory(path) {
	return directoryRegExp.test(path);
};

const memoryFsJoin = require("memory-fs/lib/join");
let memoizedJoin = {};
Resolver.prototype.join = (path, request) => {
	var memoizeKey = path + "|$" + request;
	if(!memoizedJoin[memoizeKey]) {
		memoizedJoin[memoizeKey] = memoryFsJoin(path, request);
	}
	return memoizedJoin[memoizeKey];
};

Resolver.prototype.normalize = require("memory-fs/lib/normalize");
