# t2-build

Ansible and Vagrant scripts for building t2. Targets a Ubuntu 14.04 installation or VM.

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

# license

mit/asl2
