# Run from app/build/ directory
# Desktop only. Lookout has no mobile UI.
VERSION=`grep "\"version\"" ../../app/package.json | sed -e "s|^.*\"version\": \"||" -e "s|\",$||"`
echo Building version $VERSION
perl -p -i \
  -e "s|production = false|production = true|;" \
  -e "s|dataAppName: string = appName;|dataAppName: string = 'Parula';|;" \
  -e "s|'Mustang'|'Lookout'|;" \
  -e "s|'https://mustang.im'|'https://lookout.parula.app'|;" \
  -e "s|defaultFrontend: string = '.*';$|defaultFrontend: string = 'lookout';|;" \
  -e "s|appVersion: string = '.*';$|appVersion: string = '$VERSION';|;" \
  ../logic/build.ts
perl -p -i \
  -e "s|Mustang GmbH|Beonex GmbH|g;" \
  -e "s|Mustang|Lookout|g;" \
  -e "s|https://mustang.im|https://lookout.parula.app|g;" \
  -e "s|\"name\": \"mustang\"|\"name\": \"lookout\"|;" \
  -e "s|\"version\": \".*\"|\"version\": \"$VERSION\"|;" \
  ../../desktop/package.json
perl -p -i \
  -e "s|Mustang GmbH|Beonex GmbH|g;" \
  -e "s|Mustang|Lookout|g;" \
  -e "s|https://mustang.im|https://lookout.parula.app|g;" \
  -e "s|\"name\": \"mustang\"|\"name\": \"lookout\"|;" \
  ../package.json
perl -p -i \
  -e "s|appId: im.mustang.client|appId: app.parula.lookout|;" \
  -e "s|Mustang GmbH|Beonex GmbH|g;" \
  -e "s|Mustang|Lookout|g;" \
  -e "s|mustang-mail|lookout|g;" \
  -e "s|mustang|lookout|g;" \
  ../../desktop/electron-builder.yml

perl -MFile::Copy -e "copy('../frontend/asset/icon/general/logo-parula.svg', '../frontend/asset/icon/general/logo.svg')"
perl -MFile::Copy -e "copy('../../desktop/build/icon-parula.png', '../../desktop/build/icon.png')"
