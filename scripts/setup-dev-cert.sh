#!/bin/bash
set -e

CERT_NAME="EdgeView Dev"

echo "Checking for existing certificate: $CERT_NAME"
if security find-certificate -c "$CERT_NAME" >/dev/null 2>&1; then
    echo "Certificate '$CERT_NAME' already exists."
else
    echo "Certificate not found. Creating self-signed code signing certificate..."
    echo "You may be prompted to enter your password to authorize keychain access."
    
    # Create temporary directory
    TMP_DIR=$(mktemp -d)
    
    # Generate config for code signing extension
    cat > "$TMP_DIR/openssl.cnf" <<EOF
[req]
distinguished_name = req_distinguished_name
x509_extensions = v3_req
prompt = no

[req_distinguished_name]
CN = $CERT_NAME

[v3_req]
keyUsage = critical, digitalSignature
extendedKeyUsage = codeSigning
EOF

    # Generate key and self-signed cert
    openssl req -x509 -newkey rsa:2048 -keyout "$TMP_DIR/key.pem" -out "$TMP_DIR/cert.pem" -days 3650 -nodes -config "$TMP_DIR/openssl.cnf"
    
    # Create p12 file
    # Use -legacy flag for compatibility with macOS Keychain if using OpenSSL 3+
    openssl pkcs12 -export -legacy -out "$TMP_DIR/cert.p12" -inkey "$TMP_DIR/key.pem" -in "$TMP_DIR/cert.pem" -passout pass:tempPass
    
    # Import into login keychain
    # Use the default login keychain
    LOGIN_KEYCHAIN=$(security login-keychain | xargs)
    security import "$TMP_DIR/cert.p12" -k "$LOGIN_KEYCHAIN" -P tempPass -T /usr/bin/codesign
    
    # Clean up
    rm -rf "$TMP_DIR"
    
    echo "Certificate created."
fi

echo ""
echo "IMPORTANT: You must trust this certificate for code signing to work effectively."
echo "1. Open Keychain Access app."
echo "2. Search for '$CERT_NAME'."
echo "3. Double-click the certificate."
echo "4. Expand 'Trust' section."
echo "5. Set 'Code Signing' to 'Always Trust'."
echo ""
