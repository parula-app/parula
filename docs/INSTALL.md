# Development setup

1. Install
```
(cd app/; yarn); (cd desktop/; yarn); (cd desktop/backend/; yarn); (cd lib/jpc-ws/; yarn)
```

2. In terminal 1:
```
cd app/
yarn run dev
```

3. In terminal 2:
```
cd desktop/
yarn run dev
```

# Build release

1. Install: See as dev Install above
2. Build
```
(cd app; yarn build)
(cd desktop; yarn build:win)
(cd desktop; yarn build:linux)
(cd desktop; yarn build:mac)
```

# Problems

#### sqlite3 not found

1. `rm -rf */node_modules/`
2. Repeat install

* [StackOverflow: Can't load sqlite3](https://stackoverflow.com/questions/20221825/node-js-says-it-cant-load-sqlite3-module-but-does-anyway)
* [electron-builder described on StackOverflow](https://stackoverflow.com/a/41230765)
