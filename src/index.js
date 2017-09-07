import request from 'request-promise'
import fs from 'fs'

const BASE_SENTRY_URL = 'https://sentry.io/api/0/projects'

const DEFAULT_INCLUDE = /\.js$|\.map$/
const DEFAULT_TRANSFORM = filename => `~/${filename}`
const DEFAULT_DELETE_REGEX = /\.map$/
const DEFAULT_BODY_TRANSFORM = version => ({ version })
const DEFAULT_OVERWRITE = false

module.exports = class SentryPlugin {
  constructor(options) {
    this.baseSentryURL = options.baseSentryURL || BASE_SENTRY_URL
    this.organizationSlug = options.organization || options.organisation
    this.projectSlug = options.project
    this.apiKey = options.apiKey

    this.releaseBody = options.releaseBody || DEFAULT_BODY_TRANSFORM
    this.releaseVersion = options.release

    this.include = options.include || DEFAULT_INCLUDE
    this.exclude = options.exclude

    this.filenameTransform = options.filenameTransform || DEFAULT_TRANSFORM
    this.suppressErrors = options.suppressErrors
    this.suppressConflictError = options.suppressConflictError
    this.shouldOverwrite = options.shouldOverwrite || DEFAULT_OVERWRITE

    this.deleteAfterCompile = options.deleteAfterCompile
    this.deleteRegex = options.deleteRegex || DEFAULT_DELETE_REGEX
  }

  apply(compiler) {
    compiler.plugin('after-emit', (compilation, cb) => {
      const errors = this.ensureRequiredOptions()

      if (errors) {
        return this.handleErrors(errors, compilation, cb)
      }

      const files = this.getFiles(compilation)

      if (typeof this.releaseVersion === 'function') {
        this.releaseVersion = this.releaseVersion(compilation.hash)
      }

      if (typeof this.releaseBody === 'function') {
        this.releaseBody = this.releaseBody(this.releaseVersion)
      }

      if (this.shouldOverwrite) {
        console.log('about to overwrite', this.shouldOverwrite)
        this.getReleaseArtifacts(this.releaseVersion)
          .then(resp => this.deleteArtifacts(resp))
          .catch(err => this.handleErrors(err, compilation, cb))
      }

      return this.createRelease()
        .then(() => this.uploadFiles(files))
        .then(() => cb())
        .catch(err => this.handleErrors(err, compilation, cb))
    })

    compiler.plugin('done', (stats) => {
      if (this.deleteAfterCompile) {
        this.deleteFiles(stats)
      }
    })
  }

  handleErrors(err, compilation, cb) {
    const errorMsg = `Sentry Plugin: ${err}`
    if (
      this.suppressErrors ||
      (this.suppressConflictError && err.statusCode === 409)
    ) {
      compilation.warnings.push(errorMsg)
    }
    else {
      compilation.errors.push(errorMsg)
    }

    cb()
  }

  ensureRequiredOptions() {
    if (!this.organizationSlug) {
      return new Error('Must provide organization')
    }
    else if (!this.projectSlug) {
      return new Error('Must provide project')
    }
    else if (!this.apiKey) {
      return new Error('Must provide api key')
    }
    else if (!this.releaseVersion) {
      return new Error('Must provide release version')
    }
    else {
      return null
    }
  }

  getFiles(compilation) {
    return Object.keys(compilation.assets)
      .map((name) => {
        if (this.isIncludeOrExclude(name)) {
          return { name, path: compilation.assets[name].existsAt }
        }
        return null
      })
      .filter(i => i)
  }

  isIncludeOrExclude(filename) {
    const isIncluded = this.include ? this.include.test(filename) : true
    const isExcluded = this.exclude ? this.exclude.test(filename) : false

    return isIncluded && !isExcluded
  }

  createRelease() {
    return request({
      url: `${this.sentryReleaseUrl()}/`,
      method: 'POST',
      auth: {
        bearer: this.apiKey
      },
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(this.releaseBody)
    })
  }

  uploadFiles(files) {
    return Promise.all(files.map(this.uploadFile.bind(this)))
  }

  uploadFile({ path, name }) {
    return request({
      url: `${this.sentryReleaseUrl()}/${this.releaseVersion}/files/`,
      method: 'POST',
      auth: {
        bearer: this.apiKey
      },
      formData: {
        file: fs.createReadStream(path),
        name: this.filenameTransform(name)
      }
    })
  }

  sentryReleaseUrl() {
    return `${this.baseSentryURL}/${this.organizationSlug}/${this.projectSlug}/releases` // eslint-disable-line max-len
  }

  deleteFiles(stats) {
    Object.keys(stats.compilation.assets)
      .filter(name => this.deleteRegex.test(name))
      .forEach((name) => {
        const { existsAt } = stats.compilation.assets[name]
        fs.unlinkSync(existsAt)
      })
  }

  getReleaseArtifacts(version) {
    return request({
      url: `${this.sentryReleaseUrl()}/${version}/files/`,
      method: 'GET',
      auth: {
        bearer: this.apiKey
      }
    })
  }

  deleteArtifacts(resp) {
    console.log('Response from getReleaseArtifacts', resp)
    resp
      .map(obj => obj.id)
      console.log("RESP: ", resp);
      // .forEach(id => this.deleteArtifact(id))
  }

  deleteArtifact(artifactID) {
    return request({
      url: `${this.sentryReleaseUrl()}/${this.releaseVersion}
        /files/${artifactID}`,
      method: 'DELETE',
      auth: {
        bearer: this.apiKey
      }
    })
  }
}
