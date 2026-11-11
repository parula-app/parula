# Run from mobile/android
DOWNLOAD_URL="https://github.com/mustang-im/nodejs-mobile/releases/download/v22.9.0/nodejs-mobile-v22.9.0-android.zip"
TMP_ZIP_FILE="libnode-download.zip"

echo "Downloading $DOWNLOAD_URL"
curl -L -o $TMP_ZIP_FILE "$DOWNLOAD_URL"

unzip -o $TMP_ZIP_FILE -d ./app/src/main/cpp/libnode

echo "Download and extraction complete."
