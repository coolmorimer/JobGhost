import {describe,expect,test} from 'vitest';
import {pcmRms,resamplePcm16} from './RealtimeTranscriber';

describe('resamplePcm16',()=>{
  test('converts 48 kHz float audio to 24 kHz signed PCM',()=>{
    const result=resamplePcm16(new Float32Array([1,1,0.5,0.5,-1,-1,0,0]),48000);
    expect(Array.from(result)).toEqual([32767,16384,-32768,0]);
  });

  test('never emits samples outside int16 range',()=>{
    expect(Array.from(resamplePcm16(new Float32Array([3,-3]),24000))).toEqual([32767,-32768]);
  });
});

describe('pcmRms',()=>{
  test('distinguishes silence from interview speech level',()=>{
    expect(pcmRms(new Int16Array(100))).toBe(0);
    expect(pcmRms(new Int16Array([1200,-1200,1200,-1200]))).toBeGreaterThan(0.012);
  });
});
