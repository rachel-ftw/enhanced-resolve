/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Tobias Koppers @sokra
*/
const path = require("path");
const assign = require("object-assign");
const concord = require("./concord");
const DescriptionFileUtils = require("./DescriptionFileUtils");

function ConcordMainPlugin(source, options, target) {
	this.source = source;
	this.options = options;
	this.target = target;
}
module.exports = ConcordMainPlugin;

ConcordMainPlugin.prototype.apply = function(resolver) {
	const target = this.target;
	const options = this.options;
	resolver.plugin(this.source, function(request, callback) {
		if(request.path !== request.descriptionFileRoot) return callback();
		const concordField = DescriptionFileUtils.getField(request.descriptionFileData, "concord");
		if(!concordField) return callback();
		const mainModule = concord.getMain(request.context, concordField);
		if(!mainModule) return callback();
		const obj = assign({}, request, {
			request: mainModule
		});
		const filename = path.basename(request.descriptionFilePath);
		return resolver.doResolve(target, obj, "use " + mainModule + " from " + filename, callback);
	});
};
