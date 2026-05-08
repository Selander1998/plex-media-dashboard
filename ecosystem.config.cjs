module.exports = {
  apps: [
    {
      name: "media-dashboard",
      script: "server.js",
      cwd: __dirname,
      node_args: "--env-file=.env",
      exec_mode: "fork",
      autorestart: true,
      watch: false,
    },
  ],
};
