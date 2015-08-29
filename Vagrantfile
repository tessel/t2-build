# -*- mode: ruby -*-
# vi: set ft=ruby :

Vagrant.configure(2) do |config|

  config.vm.box = "ubuntu/trusty64"

  # detect number of cores,
  # http://stackoverflow.com/questions/891537/detect-number-of-cpus-installed
  def self.processor_count
    case RbConfig::CONFIG['host_os']
    when /darwin9/
      `hwprefs cpu_count`.to_i
    when /darwin/
      ((`which hwprefs` != '') ? `hwprefs thread_count` : `sysctl -n hw.ncpu`).to_i
    when /linux/
      `cat /proc/cpuinfo | grep processor | wc -l`.to_i
    when /freebsd/
      `sysctl -n hw.ncpu`.to_i
    when /mswin|mingw/
      require 'win32ole'
      wmi = WIN32OLE.connect("winmgmts://")
      cpu = wmi.ExecQuery("select NumberOfCores from Win32_Processor") # TODO count hyper-threaded in this
      cpu.to_enum.first.NumberOfCores
    end
  end

  # virtualbox allows up to half of total mem
  def self.memory_max
    /Memory size: (\d+)/.match(`VBoxManage list hostinfo`)[1].to_i / 2
  end

  # fwd host ssh for git access
  config.ssh.forward_agent = true

  config.vm.provider "virtualbox" do |vb|
    vb.memory = memory_max
    vb.cpus = processor_count
  end

  config.vm.provision "ansible" do |ansible|
    ansible.extra_vars = {
      build_dir_owner: "vagrant",
      swap_space: "20G",
      swap_file: '/swapfile'
    }
    ansible.groups = {
      "need_swap" => ["default"]
    }
    ansible.playbook = "ansible.yml"
  end
end
