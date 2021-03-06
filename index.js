// config:
//   entry: entrypoint file
//   target: 'node' or 'client'
//   server: true/false for webpack-dev-server
//   devtool: specify webpack devtool
//   commonsChunk: split common files into commons.js chunk
//   longTermCaching: use hash name with files
//   minimize: uglify and dedupe
//   debug (bool): output debug info
//   dir: (string): absolute path to app dir
//   hot: (bool): use hot reloading
//   port (number): webpack port

var colors = require('colors');
var path = require('path');
var webpack = require('webpack');
// var ReactStylePlugin = require('react-style-webpack-plugin');
var ExtractTextPlugin = require('extract-text-webpack-plugin');
var util = require('util');
var joinEntry = require('./lib/joinEntry');
var statsPlugin = require('./lib/statsPlugin');
var linkModules = require('./lib/linkModules');

function makeAll(configs) {
  if (Array.isArray(configs))
    return configs.map(make);
  else
    return make(configs);
}

// makes from a single config object
function make(config) {
  // defaults
  config.env = config.env || 'development';
  config.debug = process.env.DEBUG || config.debug;
  config.dir = process.env.DIR || config.dir;
  config.target = process.env.TARGET || config.target;

  if (config.debug)
    console.log('Generated config: ', config);

  // target
  var node = config.target === 'node';
  var web = config.target === 'web';

  if (config.debug)
    console.log("Making webpack config with:\n".bold.blue, config, "\n");

  if (config.linkModules)
    linkModules(config.dir + '/server_modules');

  // LOADERS
  var loaders = [
    { test: /\.json$/, loader: 'json-loader' },
    { test: /\.(png|jgp|jpeg|gif|svg)$/, loader: 'url-loader?limit=10000' },
    { test: /\.html$/, loader: 'html-loader' }
  ]
  .concat(config.loaders || []);

  var jsTest = /\.jsx?$/;

  if (config.hot)
    loaders.push({ test: jsTest, loader: 'react-hot' });

  // if (node)
  //   loaders.push({ test: jsTest, loader: ReactStylePlugin.loader() });

  loaders.push({
    test: jsTest,
    loader: '6to5-loader?experimental=true&runtime=true',
    exclude: /socket\.io/
  });

  // style loaders
  var cssLoader = 'css-loader!autoprefixer-loader?browsers=last 2 version';
  var stylesheetLoaders = [
    { test: /\.css$/, loader: cssLoader },
    { test: /\.styl$/, loader: cssLoader + '!stylus-loader' }
  ];

  // various ways of handling stylesheet requires
  stylesheetLoaders.forEach(function(stylesheetLoader) {
    var loader = stylesheetLoader.loader;

    if (node)
      stylesheetLoader.loader = 'null-loader';
    else if (config.separateStylesheet)
      stylesheetLoader.loader = ExtractTextPlugin.extract('style-loader', loader);
    else
      stylesheetLoader.loader = 'style-loader!' + loader;
  });


  // WEBPACK CONFIG

  var entry = config.entry;

  // allow shorthand for single entry
  if (typeof entry === 'string') {
    entry = { main: entry };
  }

  var alias = {};
  var aliasLoader = {};
  var externals = [];
  var modulesDirectories = config.modulesDirectories || [
    'node_modules',
    'web_modules',
    'server_modules',
    // this adds a shorthand so you can require anything in ./app
    // without using relative paths
    'app'
  ];

  var extensions = config.extensions || ['', '.web.js', '.js', '.jsx'];

  var root = config.root || [path.join(config.dir)];

  var fallback = (config.fallback || ['node_modules', 'server_modules']).map(function(moduleDir) {
    return config.dir + '/' + moduleDir
  })

  var output = {
    path: path.join(config.dir, 'build',
      node ? 'prerender' : 'public'),

    filename: '[name].js' +
      (config.longTermCaching ? '?[chunkhash]' : ''),

    chunkFilename: (config.commonsChunk ? '[name].js' : '[id].js') +
      (config.longTermCaching ? '?[chunkhash]' : ''),

    publicPath: '/',
    sourceMapFilename: 'debugging/[file].map',
    libraryTarget: node ? 'commonjs2' : undefined,
    pathinfo: config.debug
  };


  // PLUGINS

  var plugins = [
    // provides a single 6to5 runtime, works in combination with &runtime=true on 6to5 loader
    new webpack.ProvidePlugin({
       to5Runtime: "imports?global=>{}!exports-loader?global.to5Runtime!6to5/runtime"
     }),

    // set process.env for modules
    new webpack.DefinePlugin({
      'process.env': {
        NODE_ENV: JSON.stringify(config.env),
        TARGET: JSON.stringify(node ? 'server' : 'client'),
        PLATFORM: JSON.stringify(config.platform || '')
      }
    })
  ];

  // prefetch
  var prefetches = config.prefetch ||
    ['react', 'react/lib/ReactComponentBrowserEnvironment'];

  prefetches.forEach(function(prefetch) {
    plugins.push(new webpack.PrefetchPlugin(prefetch));
  });

  // outputs build stats to ./build/stats.json
  if (config.debug)
    plugins.push(statsPlugin(config));

  // todo: awaiting new version of react-style
  // if (config.separateStylesheet)
  //   plugins.push(new ReactStylePlugin('bundle.css'));

  if (node) {
    aliasLoader['react-proxy$'] = 'react-proxy/unavailable';
    externals.push(/^react(\/.*)?$/);
    plugins.push(new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 }));
  }

  if (config.hot) {
    plugins.push(new webpack.HotModuleReplacementPlugin());
    plugins.push(new webpack.NoErrorsPlugin());
    entry = joinEntry('webpack/hot/only-dev-server', entry);
  }

  if (config.commonsChunk)
    plugins.push(
      new webpack.optimize.CommonsChunkPlugin('commons', 'commons.js' +
        (config.longTermCaching && !node ? '?[chunkhash]' : '')));

  if (config.server && web)
    entry = joinEntry('webpack-dev-server/client?http://localhost:' + config.port, entry);

  if (config.separateStylesheet)
    plugins.push(new ExtractTextPlugin('[name].css'));

  if (config.minimize)
    plugins.push(
      new webpack.optimize.UglifyJsPlugin(),
      new webpack.optimize.DedupePlugin()
    );


  // RETURN

  var webpackConfig = {
    entry: entry,
    output: output,
    target: config.target,
    module: {
      loaders: loaders.concat(stylesheetLoaders)
    },
    devtool: config.devtool || 'eval',
    debug: config.debug,
    resolveLoader: {
      root: config.linkModules ?
        path.join(config.dir, 'server_modules') :
        path.join(config.dir, 'node_modules'),
      alias: aliasLoader
    },
    externals: externals,
    resolve: {
      root: root,
      modulesDirectories: modulesDirectories,
      extensions: extensions,
      alias: alias,
      fallback: fallback
    },
    plugins: plugins
  };

  if (config.debug) {
    console.log('Webpack config:'.bold.blue);
    console.log(util.inspect(webpackConfig, { depth: 10 }));
    console.log();
  }

  return webpackConfig;
}

module.exports = makeAll;