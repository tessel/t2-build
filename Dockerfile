FROM ubuntu:trusty

RUN sudo apt-get install software-properties-common --yes
RUN sudo apt-add-repository ppa:ansible/ansible --yes
RUN sudo apt-get update --yes
RUN sudo apt-get install ansible --yes
RUN sudo apt-get install make --yes
RUN sudo apt-get install gawk --yes
RUN sudo apt-get install wget --yes

RUN mkdir -p /t2-build
WORKDIR /t2-build
COPY ansible.yml ansible.yml
RUN ansible-playbook -i "localhost," -c local ansible.yml --extra-vars "build_dir_owner=root"
WORKDIR /work
RUN git clone https://github.com/tessel/openwrt-tessel.git --recursive
RUN git clone https://github.com/tessel/t2-firmware --recursive
