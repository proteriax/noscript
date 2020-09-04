import * as webpack from "webpack"
import { resolve } from "path"
import SriPlugin from "webpack-subresource-integrity"
import MiniCssExtractPlugin from "mini-css-extract-plugin"

const PROD = process.env.NODE_ENV === "production"
const DEV = !PROD

export default (): webpack.Configuration => ({
  mode: PROD ? "production" : "development",
  entry: {
    background: "./src/bg/main.ts",
    options: "./src/ui/options.ts",
    popup: "./src/ui/popup.ts",
    prompt: "./src/ui/prompt.ts",
    siteInfo: "./src/ui/siteInfo.ts",
    ftp: "./src/content/ftp.ts",
    documentStart: "./src/document_start.ts",
    documentStartFile: "./src/document_start_file.ts",
  },
  output: {
    chunkFilename: "./[name].chunk.js",
    crossOriginLoading: "anonymous",
    devtoolModuleFilenameTemplate: "https://[resource-path]",
    filename: "[name].js",
    jsonpFunction: "request",
    path: resolve(__dirname, "build", "js"),
    pathinfo: DEV,
  },
  module: {
    rules: [
      {
        test: /\.[jt]sx?$/,
        loader: "babel-loader",
        exclude: /node_modules/,
        options: {
          presets: ["@babel/preset-react"],
          plugins: [
            ["@babel/plugin-transform-typescript", { allowNamespace: true }],
            "babel-plugin-macros",
            ["@babel/plugin-proposal-class-properties", { loose: true }],
            ["@babel/plugin-proposal-nullish-coalescing-operator", { loose: true }],
            ["@babel/plugin-proposal-optional-chaining", { loose: true }],
            "@babel/plugin-proposal-optional-catch-binding",
            "babel-plugin-minify-constant-folding",
          ],
        },
      },
      {
        test: /\.(le|sa|sc|c)ss$/,
        exclude: /\.module\.scss$/,
        use: [
          {
            loader: DEV ? "style-loader" : MiniCssExtractPlugin.loader,
            options: { injectType: "singletonStyleTag" },
          },
          {
            loader: "css-loader",
            options: { sourceMap: DEV, localsConvention: "camelCase" },
          },
          {
            loader: "sass-loader",
            options: { sourceMap: DEV },
          },
        ],
      },
      {
        test: /\.module\.scss$/,
        use: [
          {
            loader: "style-loader",
            options: { injectType: "styleTag" },
          },
          {
            loader: "css-loader",
            options: {
              localsConvention: "camelCase",
              modules: {
                mode: "local",
                localIdentName: "[name]__[local]___[hash:base64:5]",
              },
            },
          },
          {
            loader: "sass-loader",
            options: { sourceMap: DEV },
          },
        ],
      },
      {
        test: /\.(ttf|eot|woff|woff2)$/,
        loader: "file-loader",
        options: {
          name: "fonts/[name].[ext]",
        },
      },
    ],
  },
  node: {
    fs: "empty",
  },
  resolve: {
    extensions: ".mjs .js .jsx .json .ts .tsx".split(" "),
  },
  performance: {
    hints: "warning",
    maxAssetSize: 5000000,
    maxEntrypointSize: 5000000,
  },
  devtool: DEV ? false : "source-map",
  externals: {},
  optimization: {
    concatenateModules: true,
    splitChunks: PROD && {
      minChunks: 2,
    },
  },
  watchOptions: {
    ignored: /node_modules/,
  },
  plugins: plugins.filter(Boolean),
})

const plugins: any[] = [
  PROD && new webpack.optimize.ModuleConcatenationPlugin(),
  PROD &&
    new SriPlugin({
      hashFuncNames: ["sha384"],
      enabled: PROD,
    }),
  PROD &&
    new MiniCssExtractPlugin({
      filename: "[name].css",
    }),
]
