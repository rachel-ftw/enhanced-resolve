"use strict";
/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Tobias Koppers @sokra
*/
var Resolver = require("./Resolver");

var SyncAsyncFileSystemDecorator = require("./SyncAsyncFileSystemDecorator");

var ParsePlugin = require("./ParsePlugin");
var DescriptionFilePlugin = require("./DescriptionFilePlugin");
var NextPlugin = require("./NextPlugin");
var TryNextPlugin = require("./TryNextPlugin");
var ModuleKindPlugin = require("./ModuleKindPlugin");
var FileKindPlugin = require("./FileKindPlugin");
var JoinRequestPlugin = require("./JoinRequestPlugin");
var ModulesInHierachicDirectoriesPlugin = require("./ModulesInHierachicDirectoriesPlugin");
var ModulesInRootPlugin = require("./ModulesInRootPlugin");
var AliasPlugin = require("./AliasPlugin");
var AliasFieldPlugin = require("./AliasFieldPlugin");
var ConcordExtensionsPlugin = require("./ConcordExtensionsPlugin");
var ConcordMainPlugin = require("./ConcordMainPlugin");
var ConcordModulesPlugin = require("./ConcordModulesPlugin");
var DirectoryExistsPlugin = require("./DirectoryExistsPlugin");
var FileExistsPlugin = require("./FileExistsPlugin");
var SymlinkPlugin = require("./SymlinkPlugin");
var MainFieldPlugin = require("./MainFieldPlugin");
var UseFilePlugin = require("./UseFilePlugin");
var AppendPlugin = require("./AppendPlugin");
var ResultPlugin = require("./ResultPlugin");
var ModuleAppendPlugin = require("./ModuleAppendPlugin");
var UnsafeCachePlugin = require("./UnsafeCachePlugin");

exports.createResolver = function(options) {

	//// OPTIONS ////

	// A list of directories to resolve modules from, can be absolute path or folder name
	let modules = options.modules || ["node_modules"];

	// A list of description files to read from
	const descriptionFiles = options.descriptionFiles || ["package.json"];

	// A list of additional resolve plugins which should be applied
	// The slice is there to create a copy, because otherwise pushing into plugins
	// changes the original options.plugins array, causing duplicate plugins
	const plugins = (options.plugins && options.plugins.slice()) || [];

	// A list of main fields in description files
	let mainFields = options.mainFields || ["main"];

	// A list of alias fields in description files
	const aliasFields = options.aliasFields || [];

	// A list of main files in directories
	const mainFiles = options.mainFiles || ["index"];

	// A list of extensions which should be tried for files
	let extensions = options.extensions || [".js", ".json", ".node"];

	// Enforce that a extension from extensions must be used
	const enforceExtension = options.enforceExtension || false;

	// A list of module extensions which should be tried for modules
	let moduleExtensions = options.moduleExtensions || [];

	// Enforce that a extension from moduleExtensions must be used
	const enforceModuleExtension = options.enforceModuleExtension || false;

	// A list of module alias configurations or an object which maps key to value
	let alias = options.alias || [];

	// Resolve symlinks to their symlinked location
	const symlinks = typeof options.symlinks !== "undefined" ? options.symlinks : true;

	// Resolve to a context instead of a file
	const resolveToContext = options.resolveToContext || false;

	// Use this cache object to unsafely cache the successful requests
	let unsafeCache = options.unsafeCache || false;

	// A function which decides whether a request should be cached or not.
	// an object is passed with `path` and `request` properties.
	const cachePredicate = options.cachePredicate || function() {
		return true;
	};

	// The file system which should be used
	const fileSystem = options.fileSystem;

	// Use only the sync constiants of the file system calls
	const useSyncFileSystemCalls = options.useSyncFileSystemCalls;

	// A prepared Resolver to which the plugins are attached
	let resolver = options.resolver;

	//// options processing ////

	if(!resolver) {
		resolver = new Resolver(useSyncFileSystemCalls ? new SyncAsyncFileSystemDecorator(fileSystem) : fileSystem);
	}

	extensions = [].concat(extensions);
	moduleExtensions = [].concat(moduleExtensions);

	modules = mergeFilteredToArray([].concat(modules), item => !isAbsolutePath(item));

	mainFields = mainFields.map(item => {
		if(typeof item === "string") {
			item = {
				name: item,
				forceRelative: true
			};
		}
		return item;
	});

	if(typeof alias === "object" && !Array.isArray(alias)) {
		alias = Object.keys(alias).map(key => {
			let onlyModule = false;
			let obj = alias[key];
			if(/\$$/.test(key)) {
				onlyModule = true;
				key = key.substr(0, key.length - 1);
			}
			if(typeof obj === "string") {
				obj = {
					alias: obj
				};
			}
			obj = Object.assign({
				name: key,
				onlyModule: onlyModule
			}, obj);
			return obj;
		});
	}

	if(unsafeCache && typeof unsafeCache !== "object") {
		unsafeCache = {};
	}

	//// pipeline ////

	// resolve
	if(unsafeCache) {
		plugins.push(new UnsafeCachePlugin("resolve", cachePredicate, unsafeCache, "new-resolve"));
		plugins.push(new ParsePlugin("new-resolve", "parsed-resolve"));
	} else {
		plugins.push(new ParsePlugin("resolve", "parsed-resolve"));
	}

	// parsed-resolve
	plugins.push(new DescriptionFilePlugin("parsed-resolve", descriptionFiles, "described-resolve"));
	plugins.push(new NextPlugin("after-parsed-resolve", "described-resolve"));

	// described-resolve
	alias.forEach(function(item) {
		plugins.push(new AliasPlugin("described-resolve", item, "resolve"));
	});
	plugins.push(new ConcordModulesPlugin("described-resolve", {}, "resolve"));
	aliasFields.forEach(function(item) {
		plugins.push(new AliasFieldPlugin("described-resolve", item, "resolve"));
	});
	plugins.push(new ModuleKindPlugin("after-described-resolve", "raw-module"));
	plugins.push(new JoinRequestPlugin("after-described-resolve", "relative"));

	// raw-module
	moduleExtensions.forEach(function(item) {
		plugins.push(new ModuleAppendPlugin("raw-module", item, "module"));
	});
	if(!enforceModuleExtension)
		plugins.push(new TryNextPlugin("raw-module", null, "module"));

	// module
	modules.forEach(function(item) {
		if(Array.isArray(item))
			plugins.push(new ModulesInHierachicDirectoriesPlugin("module", item, "resolve"));
		else
			plugins.push(new ModulesInRootPlugin("module", item, "resolve"));
	});

	// relative
	plugins.push(new DescriptionFilePlugin("relative", descriptionFiles, "described-relative"));
	plugins.push(new NextPlugin("after-relative", "described-relative"));

	// described-relative
	plugins.push(new FileKindPlugin("described-relative", "raw-file"));
	plugins.push(new TryNextPlugin("described-relative", "as directory", "directory"));

	// directory
	plugins.push(new DirectoryExistsPlugin("directory", "existing-directory"));

	if(resolveToContext) {

		// existing-directory
		plugins.push(new NextPlugin("existing-directory", "resolved"));

	} else {

		// existing-directory
		plugins.push(new ConcordMainPlugin("existing-directory", {}, "resolve"));
		mainFields.forEach(function(item) {
			plugins.push(new MainFieldPlugin("existing-directory", item, "resolve"));
		});
		mainFiles.forEach(function(item) {
			plugins.push(new UseFilePlugin("existing-directory", item, "undescribed-raw-file"));
		});

		// undescribed-raw-file
		plugins.push(new DescriptionFilePlugin("undescribed-raw-file", descriptionFiles, "raw-file"));
		plugins.push(new NextPlugin("after-undescribed-raw-file", "raw-file"));

		// raw-file
		if(!enforceExtension)
			plugins.push(new TryNextPlugin("raw-file", "no extension", "file"));
		plugins.push(new ConcordExtensionsPlugin("raw-file", {}, "file"));
		extensions.forEach(function(item) {
			plugins.push(new AppendPlugin("raw-file", item, "file"));
		});

		// file
		alias.forEach(function(item) {
			plugins.push(new AliasPlugin("file", item, "resolve"));
		});
		plugins.push(new ConcordModulesPlugin("file", {}, "resolve"));
		aliasFields.forEach(function(item) {
			plugins.push(new AliasFieldPlugin("file", item, "resolve"));
		});
		if(symlinks)
			plugins.push(new SymlinkPlugin("file", "relative"));
		plugins.push(new FileExistsPlugin("file", "existing-file"));

		// existing-file
		plugins.push(new NextPlugin("existing-file", "resolved"));

	}

	// resolved
	plugins.push(new ResultPlugin("resolved"));

	//// RESOLVER ////

	plugins.forEach(function(plugin) {
		resolver.apply(plugin);
	});
	return resolver;
};

function mergeFilteredToArray(array, filter) {
	return array.reduce((array, item) => {
		if(filter(item)) {
			const lastElement = array[array.length - 1];
			if(Array.isArray(lastElement)) {
				lastElement.push(item);
			} else {
				array.push([item]);
			}
			return array;
		} else {
			array.push(item);
			return array;
		}
	}, []);
}

function isAbsolutePath(path) {
	return /^[A-Z]:|^\//.test(path);
}
