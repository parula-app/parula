# Debugging

## Android

### Frontend

1. Do the steps to build
2. Replace the step for `yarn build:android` with `cd android && ./gradlew assembleDebug`
3. Run the emulator
4. Install the APK from `/android/app/build/outputs/apk/app-debug.apk`
5. Run the app
6. Open Chrome browser
7. Go to `chrome://inspect/#devices`
8. See your app under the `Remote Target`
9. Click inspect
