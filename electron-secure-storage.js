const { safeStorage, app } = require('electron');
const fs = require('fs');
const path = require('path');

/**
 * Secure storage manager for API tokens using Electron's safeStorage API.
 * Provides encryption/decryption and migration from plaintext config.
 */
class SecureStorageManager {
    constructor() {
        this.configDir = path.join(app.getPath('home'), '.edgeview-launcher');
        this.secureTokensPath = path.join(this.configDir, 'secure-tokens.enc');
        this.configPath = path.join(this.configDir, 'config.json');
        this.backupPath = path.join(this.configDir, 'config.json.backup');
        this.cachedTokens = null; // In-memory cache for decrypted tokens
    }

    /**
     * Check if safeStorage encryption is available on this platform
     */
    isEncryptionAvailable() {
        try {
            return safeStorage.isEncryptionAvailable();
        } catch (err) {
            console.error('[SecureStorage] Error checking encryption availability:', err);
            return false;
        }
    }

    /**
     * Ensure config directory exists
     */
    ensureConfigDir() {
        if (!fs.existsSync(this.configDir)) {
            fs.mkdirSync(this.configDir, { recursive: true, mode: 0o700 });
        }
    }

    /**
     * Read and decrypt all tokens from secure storage
     * @returns {Object} Map of cluster names to tokens, or null if file doesn't exist
     */
    getAllTokens() {
        // Return cached tokens if available to avoid repeated Keychain prompts
        if (this.cachedTokens) {
            return this.cachedTokens;
        }

        if (!fs.existsSync(this.secureTokensPath)) {
            return null;
        }

        try {
            const encryptedData = fs.readFileSync(this.secureTokensPath, 'utf8');
            const buffer = Buffer.from(encryptedData, 'base64');
            const decrypted = safeStorage.decryptString(buffer);
            this.cachedTokens = JSON.parse(decrypted);
            return this.cachedTokens;
        } catch (err) {
            console.error('[SecureStorage] Failed to decrypt tokens:', err);
            throw new Error('Failed to decrypt tokens. You may need to re-enter your credentials.');
        }
    }

    /**
     * Encrypt and save tokens to secure storage
     * @param {Object} tokensMap - Map of cluster names to API tokens
     */
    saveAllTokens(tokensMap) {
        this.ensureConfigDir();

        try {
            const jsonString = JSON.stringify(tokensMap);
            const encrypted = safeStorage.encryptString(jsonString);
            const base64Data = encrypted.toString('base64');
            
            fs.writeFileSync(this.secureTokensPath, base64Data, { mode: 0o600 });
            this.cachedTokens = tokensMap; // Update cache
            console.log('[SecureStorage] Tokens saved successfully');
        } catch (err) {
            console.error('[SecureStorage] Failed to encrypt tokens:', err);
            throw new Error('Failed to encrypt tokens: ' + err.message);
        }
    }

    /**
     * Get a single token by cluster name
     * @param {string} clusterName
     * @returns {string|null} The API token or null if not found
     */
    getToken(clusterName) {
        const tokens = this.getAllTokens();
        return tokens ? tokens[clusterName] || null : null;
    }

    /**
     * Set a single token for a cluster
     * @param {string} clusterName
     * @param {string} token
     */
    setToken(clusterName, token) {
        let tokens = this.getAllTokens() || {};
        tokens[clusterName] = token;
        this.saveAllTokens(tokens);
    }

    /**
     * Delete a token for a cluster
     * @param {string} clusterName
     */
    deleteToken(clusterName) {
        let tokens = this.getAllTokens();
        if (tokens && tokens[clusterName]) {
            delete tokens[clusterName];
            this.saveAllTokens(tokens);
        }
    }

    /**
     * Check if config.json has plaintext tokens that need migration
     * @returns {boolean}
     */
    needsMigration() {
        if (!fs.existsSync(this.configPath)) {
            return false;
        }

        try {
            const configData = fs.readFileSync(this.configPath, 'utf8');
            const config = JSON.parse(configData);
            
            // Check if any cluster has apiToken field with non-empty value
            if (config.clusters && Array.isArray(config.clusters)) {
                return config.clusters.some(cluster => 
                    cluster.apiToken && cluster.apiToken.trim() !== ''
                );
            }
        } catch (err) {
            console.error('[SecureStorage] Error checking migration need:', err);
        }

        return false;
    }

    /**
     * Migrate plaintext tokens from config.json to secure storage
     * @returns {Object} Result object with success status and message
     */
    migrateFromPlaintext() {
        if (!this.isEncryptionAvailable()) {
            return {
                success: false,
                error: 'Secure storage is not available on this system'
            };
        }

        if (!fs.existsSync(this.configPath)) {
            return {
                success: false,
                error: 'Config file not found'
            };
        }

        try {
            // Read existing config
            const configData = fs.readFileSync(this.configPath, 'utf8');
            const config = JSON.parse(configData);

            if (!config.clusters || !Array.isArray(config.clusters)) {
                return {
                    success: false,
                    error: 'No clusters found in config'
                };
            }

            // Create backup
            fs.writeFileSync(this.backupPath, configData, { mode: 0o600 });
            console.log('[SecureStorage] Backup created at:', this.backupPath);

            // Extract tokens
            let tokensMap = {};
            
            // Load existing secure tokens to merge with
            if (fs.existsSync(this.secureTokensPath)) {
                try {
                    const existingTokens = this.getAllTokens();
                    if (existingTokens) {
                        tokensMap = existingTokens;
                    }
                } catch (err) {
                    console.warn('[SecureStorage] Failed to load existing tokens for merge:', err);
                    // Continue with empty map if decryption fails
                }
            }

            let tokenCount = 0;

            config.clusters.forEach(cluster => {
                if (cluster.apiToken && cluster.apiToken.trim() !== '') {
                    tokensMap[cluster.name] = cluster.apiToken;
                    tokenCount++;
                }
            });

            if (tokenCount === 0) {
                return {
                    success: false,
                    error: 'No tokens found to migrate'
                };
            }

            // Save tokens to secure storage
            this.saveAllTokens(tokensMap);

            // Update config.json - remove apiToken fields, add tokenEncrypted flag
            config.clusters = config.clusters.map(cluster => ({
                name: cluster.name,
                baseUrl: cluster.baseUrl,
                tokenEncrypted: tokensMap[cluster.name] ? true : false
            }));

            // Save updated config
            fs.writeFileSync(
                this.configPath, 
                JSON.stringify(config, null, 2),
                { mode: 0o600 }
            );

            console.log(`[SecureStorage] Migration successful: ${tokenCount} token(s) migrated`);

            return {
                success: true,
                message: `Successfully migrated ${tokenCount} token(s) to secure storage`,
                tokenCount: tokenCount
            };

        } catch (err) {
            console.error('[SecureStorage] Migration failed:', err);
            
            // Attempt to restore from backup
            if (fs.existsSync(this.backupPath)) {
                try {
                    const backupData = fs.readFileSync(this.backupPath, 'utf8');
                    fs.writeFileSync(this.configPath, backupData, { mode: 0o600 });
                    console.log('[SecureStorage] Restored from backup after migration failure');
                } catch (restoreErr) {
                    console.error('[SecureStorage] Failed to restore from backup:', restoreErr);
                }
            }

            return {
                success: false,
                error: 'Migration failed: ' + err.message
            };
        }
    }

    /**
     * Load complete configuration with decrypted tokens merged in
     * @returns {Object} Config object with tokens included
     */
    loadConfigWithTokens() {
        if (!fs.existsSync(this.configPath)) {
            return null;
        }

        try {
            const configData = fs.readFileSync(this.configPath, 'utf8');
            const config = JSON.parse(configData);

            // If encryption is available and secure tokens exist, merge them
            if (this.isEncryptionAvailable() && fs.existsSync(this.secureTokensPath)) {
                const tokens = this.getAllTokens();
                
                if (tokens && config.clusters) {
                    config.clusters = config.clusters.map(cluster => {
                        const secureToken = tokens[cluster.name];
                        return {
                            ...cluster,
                            // Use secure token if available, otherwise preserve existing legacy token
                            apiToken: secureToken || cluster.apiToken || '',
                            // If we injected a secure token, ensure the flag is true so backend knows 
                            // not to write it to disk. Preserve existing flag otherwise.
                            tokenEncrypted: secureToken ? true : (cluster.tokenEncrypted || false)
                        };
                    });
                }
            }

            return config;
        } catch (err) {
            console.error('[SecureStorage] Error loading config with tokens:', err);
            throw err;
        }
    }

    /**
     * Save configuration with tokens extracted to secure storage
     * @param {Object} config - Full config object with clusters including apiToken fields
     */
    saveConfigWithTokens(config) {
        this.ensureConfigDir();

        try {
            // Extract tokens
            const tokensMap = {};
            
            if (config.clusters && Array.isArray(config.clusters)) {
                config.clusters.forEach(cluster => {
                    if (cluster.apiToken && cluster.apiToken.trim() !== '') {
                        tokensMap[cluster.name] = cluster.apiToken;
                    }
                });
            }

            // Save tokens to secure storage if encryption is available
            if (this.isEncryptionAvailable() && Object.keys(tokensMap).length > 0) {
                this.saveAllTokens(tokensMap);
            }

            // Save config without tokens
            const configToSave = {
                ...config,
                clusters: config.clusters.map(cluster => ({
                    name: cluster.name,
                    baseUrl: cluster.baseUrl,
                    tokenEncrypted: this.isEncryptionAvailable() && tokensMap[cluster.name] ? true : false
                }))
            };

            fs.writeFileSync(
                this.configPath,
                JSON.stringify(configToSave, null, 2),
                { mode: 0o600 }
            );

            console.log('[SecureStorage] Config saved successfully');
        } catch (err) {
            console.error('[SecureStorage] Error saving config with tokens:', err);
            throw err;
        }
    }

    /**
     * Get secure storage status information
     * @returns {Object} Status object
     */
    getStatus() {
        return {
            encryptionAvailable: this.isEncryptionAvailable(),
            secureTokensExist: fs.existsSync(this.secureTokensPath),
            needsMigration: this.needsMigration(),
            backupExists: fs.existsSync(this.backupPath)
        };
    }
}

module.exports = SecureStorageManager;
