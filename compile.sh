#!/bin/bash

FOLDER_PATH=$1

if [[ "$FOLDER_PATH" == '' ]]; then
	echo 'Usage: compile.sh node/module/path'
	exit 1
fi


read -r -d '' RUN_SCRIPT <<'EOF'
#!/bin/bash

set -x
set -e

export NVM_DIR="/home/vagrant/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"  # This loads nvm
nvm use stable

mkdir -p /work/binary-module/build
mkdir -p /work/binary-module/output
cd /work/binary-module/build

pre-gypify --package_name "{name}-v{version}-{node_abi}-{platform}-{arch}-{configuration}.tar.gz"

export STAGING_DIR=/work/openwrt-tessel/openwrt/staging_dir
export NODEGYP=node-gyp
export NODE=4.1.2
export TOOLCHAIN_ARCH=mipsel
#export ARCH=mipsel

echo OHOHOH
echo $TOOLCHAIN_ARCH
echo $NODE

set -e

if [ ! -d "$STAGING_DIR" ]; then
    echo "STAGING_DIR needs to be set to your cross toolchain path";
    exit 1
fi

ARCH=${ARCH:-mipsel}
NODE=${NODE:-4.1.2}
NODEGYP=${NODEGYP:-node-gyp}

TOOLCHAIN_DIR=$(ls -d "$STAGING_DIR/toolchain-"*"$TOOLCHAIN_ARCH"*)
echo $TOOLCHAIN_DIR

export SYSROOT=$(ls -d "$STAGING_DIR/target-"*"$TOOLCHAIN_ARCH"*)

source $TOOLCHAIN_DIR/info.mk # almost a bash script

echo "Cross-compiling for" $TARGET_CROSS

export PATH=$TOOLCHAIN_DIR/bin:$PATH
export CPPPATH=$TARGET_DIR/usr/include
export LIBPATH=$TARGET_DIR/usr/lib

#TODO: anything better than this hack?
OPTS="-I $SYSROOT/usr/include -L $TOOLCHAIN_DIR/lib -L $SYSROOT/usr/lib"

export CC="${TARGET_CROSS}gcc $OPTS"
export CXX="${TARGET_CROSS}g++ $OPTS"
export AR=${TARGET_CROSS}ar
export RANLIB=${TARGET_CROSS}ranlib
export LINK="${TARGET_CROSS}g++ $OPTS"
export CPP="${TARGET_CROSS}gcc $OPTS -E"
export STRIP=${TARGET_CROSS}strip
export OBJCOPY=${TARGET_CROSS}objcopy
export LD="${TARGET_CROSS}g++ $OPTS"
export OBJDUMP=${TARGET_CROSS}objdump
export NM=${TARGET_CROSS}nm
export AS=${TARGET_CROSS}as

export npm_config_arch=$ARCH
export npm_config_node_gyp=$(which $NODEGYP)
npm install --ignore-scripts

node-pre-gyp rebuild --target_platform=openwrt --target_arch=$ARCH --target=$NODE --debug
node-pre-gyp package --target_platform=openwrt --target_arch=$ARCH --target=$NODE --debug
find build/stage -type f | xargs -i cp {} /work/binary-module/output
node-pre-gyp rebuild --target_platform=openwrt --target_arch=$ARCH --target=$NODE
node-pre-gyp package --target_platform=openwrt --target_arch=$ARCH --target=$NODE
find build/stage -type f | xargs -i cp {} /work/binary-module/output
EOF

set -x
set -e

cd $(dirname $0)

vagrant ssh-config > ssh.conf

vagrant ssh -c 'rm -rf /work/binary-module/build
mkdir -p /work/binary-module/build'

rsync -avz -e 'ssh -F ./ssh.conf' $FOLDER_PATH/. default:/work/binary-module/build

vagrant ssh -c "$RUN_SCRIPT" || exit 1

rsync -avz -e 'ssh -F ./ssh.conf' default:/work/binary-module/output/. ~/.tessel/binaries
