# t2-build

[![Code of Conduct](https://img.shields.io/badge/%E2%9D%A4-code%20of%20conduct-blue.svg?style=flat)](https://github.com/tessel/project/blob/master/CONDUCT.md)

Ansible and Vagrant scripts for building t2. Targets a Ubuntu 14.04 installation or VM.

**NOTE:** You will need to have `ansible` installed before running.

```
vagrant up
vagrant ssh
$ cd /work
$ git clone --recursive https://github.com/tessel/openwrt-tessel.git
$ cd openwrt-tessel
$ make -j64; make -j64; make -j64 V=s
$ cd /work
$ git clone https://github.com/tessel/t2-firmware --recursive
$ cd t2-firmware
$ make -j64
```

To generate `toolchain-mipsel.tar.gz` for `t2-compiler`, run:

```
tar -cvzf /work/toolchain-mipsel.tar.gz \
  -C /work/openwrt-tessel/openwrt/staging_dir/ \
  target-mipsel_24kec+dsp_uClibc-0.9.33.2 \
  toolchain-mipsel_24kec+dsp_gcc-4.8-linaro_uClibc-0.9.33.2
```

...and upload the resulting `/work/toolchain-mipsel.tar.gz` file.

# License

MIT or Apache2-.0, at your option.
