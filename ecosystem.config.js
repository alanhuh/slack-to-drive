/**
 * PM2 Ecosystem Configuration
 *
 * PM2 process manager configuration for automatic restart and monitoring
 *
 * Usage:
 *   pm2 start ecosystem.config.js
 *   pm2 stop slack-to-drive
 *   pm2 restart slack-to-drive
 *   pm2 logs slack-to-drive
 *   pm2 monit
 */

module.exports = {
  apps: [{
    name: 'slack-to-drive',
    script: './server.js',

    // Instance settings
    instances: 1,
    exec_mode: 'fork',

    // Restart settings
    autorestart: true,
    watch: false, // Don't watch for file changes in production
    max_memory_restart: '400M', // Restart if memory exceeds 400MB (Render free tier: 512MB)

    // Error handling
    max_restarts: 10, // Maximum number of restarts within min_uptime
    min_uptime: '10s', // Minimum uptime before considering stable

    // Environment variables
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
    },

    // Logging
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    merge_logs: true,
    time: true, // Prefix logs with timestamp

    // Advanced settings
    kill_timeout: 5000, // Time to wait before force killing (ms)
    listen_timeout: 3000, // Time to wait for app to be ready (ms)

    // Graceful shutdown
    shutdown_with_message: true,
    wait_ready: false,
  }]
};
