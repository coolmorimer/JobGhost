import {expect,test} from 'vitest';
import {rectangleBetween} from './RegionPicker';

test('normalizes a region dragged in either direction',()=>{
  expect(rectangleBetween({x:.8,y:.7},{x:.2,y:.1})).toEqual({x:.2,y:.1,width:.6000000000000001,height:.6});
});
