'use strict';

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _requestPromise = require('request-promise');

var _requestPromise2 = _interopRequireDefault(_requestPromise);

var _fs = require('fs');

var _fs2 = _interopRequireDefault(_fs);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var BASE_SENTRY_URL = 'https://sentry.io/api/0/projects';

var DEFAULT_INCLUDE = /\.js$|\.map$/;
var DEFAULT_TRANSFORM = function DEFAULT_TRANSFORM(filename) {
  return '~/' + filename;
};
var DEFAULT_DELETE_REGEX = /\.map$/;
var DEFAULT_BODY_TRANSFORM = function DEFAULT_BODY_TRANSFORM(version) {
  return { version: version };
};
var DEFAULT_OVERWRITE = false;

module.exports = function () {
  function SentryPlugin(options) {
    _classCallCheck(this, SentryPlugin);

    this.baseSentryURL = options.baseSentryURL || BASE_SENTRY_URL;
    this.organizationSlug = options.organization || options.organisation;
    this.projectSlug = options.project;
    this.apiKey = options.apiKey;

    this.releaseBody = options.releaseBody || DEFAULT_BODY_TRANSFORM;
    this.releaseVersion = options.release;

    this.include = options.include || DEFAULT_INCLUDE;
    this.exclude = options.exclude;

    this.filenameTransform = options.filenameTransform || DEFAULT_TRANSFORM;
    this.suppressErrors = options.suppressErrors;
    this.suppressConflictError = options.suppressConflictError;
    this.shouldOverwrite = options.shouldOverwrite || DEFAULT_OVERWRITE;

    this.deleteAfterCompile = options.deleteAfterCompile;
    this.deleteRegex = options.deleteRegex || DEFAULT_DELETE_REGEX;
  }

  _createClass(SentryPlugin, [{
    key: 'apply',
    value: function apply(compiler) {
      var _this = this;

      compiler.plugin('after-emit', function (compilation, cb) {
        var errors = _this.ensureRequiredOptions();

        if (errors) {
          return _this.handleErrors(errors, compilation, cb);
        }

        var files = _this.getFiles(compilation);

        if (typeof _this.releaseVersion === 'function') {
          _this.releaseVersion = _this.releaseVersion(compilation.hash);
        }

        if (typeof _this.releaseBody === 'function') {
          _this.releaseBody = _this.releaseBody(_this.releaseVersion);
        }

        return _this.createRelease().then(function () {
          return _this.getReleaseArtifacts(_this.releaseVersion);
        }).then(function (resp) {
          return _this.deleteArtifacts(resp);
        }).then(function () {
          return _this.uploadFiles(files);
        }).then(function () {
          return cb();
        }).catch(function (err) {
          return _this.handleErrors(err, compilation, cb);
        });
      });

      compiler.plugin('done', function (stats) {
        if (_this.deleteAfterCompile) {
          _this.deleteFiles(stats);
        }
      });
    }
  }, {
    key: 'handleErrors',
    value: function handleErrors(err, compilation, cb) {
      var errorMsg = 'Sentry Plugin: ' + err;
      if (this.suppressErrors || this.suppressConflictError && err.statusCode === 409) {
        compilation.warnings.push(errorMsg);
      } else {
        compilation.errors.push(errorMsg);
      }

      cb();
    }
  }, {
    key: 'ensureRequiredOptions',
    value: function ensureRequiredOptions() {
      if (!this.organizationSlug) {
        return new Error('Must provide organization');
      } else if (!this.projectSlug) {
        return new Error('Must provide project');
      } else if (!this.apiKey) {
        return new Error('Must provide api key');
      } else if (!this.releaseVersion) {
        return new Error('Must provide release version');
      } else {
        return null;
      }
    }
  }, {
    key: 'getFiles',
    value: function getFiles(compilation) {
      var _this2 = this;

      return Object.keys(compilation.assets).map(function (name) {
        if (_this2.isIncludeOrExclude(name)) {
          return { name: name, path: compilation.assets[name].existsAt };
        }
        return null;
      }).filter(function (i) {
        return i;
      });
    }
  }, {
    key: 'isIncludeOrExclude',
    value: function isIncludeOrExclude(filename) {
      var isIncluded = this.include ? this.include.test(filename) : true;
      var isExcluded = this.exclude ? this.exclude.test(filename) : false;

      return isIncluded && !isExcluded;
    }
  }, {
    key: 'createRelease',
    value: function createRelease() {
      return (0, _requestPromise2.default)({
        url: this.sentryReleaseUrl() + '/',
        method: 'POST',
        auth: {
          bearer: this.apiKey
        },
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(this.releaseBody)
      });
    }
  }, {
    key: 'uploadFiles',
    value: function uploadFiles(files) {
      return Promise.all(files.map(this.uploadFile.bind(this)));
    }
  }, {
    key: 'uploadFile',
    value: function uploadFile(_ref) {
      var path = _ref.path,
          name = _ref.name;

      return (0, _requestPromise2.default)({
        url: this.sentryReleaseUrl() + '/' + this.releaseVersion + '/files/',
        method: 'POST',
        auth: {
          bearer: this.apiKey
        },
        formData: {
          file: _fs2.default.createReadStream(path),
          name: this.filenameTransform(name)
        }
      });
    }
  }, {
    key: 'sentryReleaseUrl',
    value: function sentryReleaseUrl() {
      return this.baseSentryURL + '/' + this.organizationSlug + '/' + this.projectSlug + '/releases'; // eslint-disable-line max-len
    }
  }, {
    key: 'deleteFiles',
    value: function deleteFiles(stats) {
      var _this3 = this;

      Object.keys(stats.compilation.assets).filter(function (name) {
        return _this3.deleteRegex.test(name);
      }).forEach(function (name) {
        var existsAt = stats.compilation.assets[name].existsAt;

        _fs2.default.unlinkSync(existsAt);
      });
    }
  }, {
    key: 'getReleaseArtifacts',
    value: function getReleaseArtifacts(version) {
      return (0, _requestPromise2.default)({
        url: this.sentryReleaseUrl() + '/' + version + '/files/',
        method: 'GET',
        auth: {
          bearer: this.apiKey
        }
      });
    }
  }, {
    key: 'deleteArtifacts',
    value: function deleteArtifacts(response) {
      var _this4 = this;

      if (this.shouldOverwrite) {
        var resp = JSON.parse(response);
        resp.forEach(function (artifact) {
          var artifactID = artifact.id;
          if (artifactID) {
            _this4.deleteArtifact(artifactID);
          }
        });
      }
    }
  }, {
    key: 'deleteArtifact',
    value: function deleteArtifact(id) {
      return (0, _requestPromise2.default)({
        url: this.sentryReleaseUrl() + '/' + this.releaseVersion + '/files/' + id + '/',
        method: 'DELETE',
        auth: {
          bearer: this.apiKey
        }
      });
    }
  }]);

  return SentryPlugin;
}();