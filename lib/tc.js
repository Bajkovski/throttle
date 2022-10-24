'use strict';
const shell = require('./shell');
const sudo = require('./sudo');

async function getDefaultInterface() {
  const result = await shell(
    "sudo route | grep -m 1 '^default' | grep -o '[^ ]*$' | tr -d '\n'",
    { shell: true }
  );

  if (result.stdout.length === 0 && result.stderr.length > 0) {
    throw new Error(
      'There was an error getting the default interface:\n\n' + result.stderr
    );
  }

  return result.stdout;
}

async function modProbe() {
  try {
    await sudo('modprobe', 'ifb');
  } catch (e) {
    // we are probably in a Docker env
    // let us hope that the host is Linux
    try {
      await sudo('ip', 'link', 'add', 'ifb0', 'type', 'ifb');
    } catch (e) {
      // If we already setup ifb in a previous run, this will fail
    }
  }
}

async function setup(defaultInterface) {
  await sudo('ip', 'link', 'set', 'dev', 'ifb0', 'up');
  await sudo('tc', 'qdisc', 'add', 'dev', defaultInterface, 'ingress');
  await sudo(
    'tc',
    'filter',
    'add',
    'dev',
    defaultInterface,
    'parent',
    'ffff:',
    'protocol',
    'ip',
    'u32',
    'match',
    'u32',
    '0',
    '0',
    'flowid',
    '1:1',
    'action',
    'mirred',
    'egress',
    'redirect',
    'dev',
    'ifb0'
  );
}

async function setLimits(up, down, halfWayRTT, packetLoss, jitter, iFace) {
    const paramsIngress = [
      'tc',
      'qdisc',
      'add',
      'dev',
      'ifb0',
      'root',
      'handle',
      '1:0',
      'netem',
    ];
    const paramsEgress = [
      'tc',
      'qdisc',
      'add',
      'dev',
      iFace,
      'root',
      'handle',
      '1:0',
      'netem',
    ];

    if(halfWayRTT>0){
      paramsIngress.push('delay', `${halfWayRTT}ms`);
      paramsEgress.push('delay', `${halfWayRTT}ms`);
    
      if(jitter>0){
        paramsIngress.push(`${jitter}ms`);
        paramsEgress.push(`${jitter}ms`);
        console.log("jitter "+jitter);
      }
    }
    if(down>0){
      paramsIngress.push('rate', `${down}kbit`)
    }
    if(up>0){
      paramsEgress.push('rate', `${up}kbit`)
    }

    if (packetLoss>0) {
      paramsIngress.push('loss', `${packetLoss}%`);
      paramsEgress.push('loss', `${packetLoss}%`);
    }

    if(down>0 || halfWayRTT>0 || packetLoss>0)
    await sudo.apply(this, paramsIngress);
    if(up>0 || halfWayRTT>0 || packetLoss>0)
    await sudo.apply(this, paramsEgress);
  
  }




module.exports = {
  async start(up, down, rtt = 0, packetLoss = 0, jitter) {
    const halfWayRTT = rtt / 2;

    try {
      await this.stop();
    } catch (e) {
      // ignore
    }

    const iFace = await getDefaultInterface();
    await modProbe();
    await setup(iFace);
    await setLimits(up, down, halfWayRTT, packetLoss, jitter, iFace);
  },
  async stop() {
    const iFace = await getDefaultInterface();

    try {
      try {
        await sudo('tc', 'qdisc', 'del', 'dev', iFace, 'root');
        await sudo('tc', 'qdisc', 'del', 'dev', iFace, 'ingress');
      } catch (e) {
        // make sure we try to remove the ingress
        await sudo('tc', 'qdisc', 'del', 'dev', iFace, 'ingress');
      }
    } catch (e) {
      // ignore
    }

    try {
      await sudo('tc', 'qdisc', 'del', 'dev', 'ifb0', 'root');
    } catch (e) {
      // do nada
    }
  }
};