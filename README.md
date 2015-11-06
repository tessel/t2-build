# t2-build

Ansible, Docker, and Vagrant scripts for building t2. Targets a Ubuntu 14.04 installation or VM.


## vagrant

```bash
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

## docker

```bash
$ docker build -t t2 .
$ docker create -t -i t2 bash --name t2-build
$ docker start -a -i t2-build
```

This will land you in bash in the /work directory, with a subdirectory for the
firmware and openwrt-tessel repos.  You can run `make -j50 V=s` to build the
OpenWRT image inside openwrt-tessel.

# license

mit/asl2
