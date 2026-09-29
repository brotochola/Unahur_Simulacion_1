(module
 (type $0 (func (param i32) (result i32)))
 (type $1 (func (param i32 i32)))
 (type $2 (func (param i32 i32 i32) (result i32)))
 (import "env" "memory" (memory $0 1 4096 shared))
 (table $0 1 1 funcref)
 (elem $0 (i32.const 1))
 (export "requiredBytes" (func $assembly/renderqueue/requiredBytes))
 (export "radixSortQueue" (func $assembly/renderqueue/radixSortQueue))
 (export "reinsertUpdateQueue" (func $assembly/renderqueue/reinsertUpdateQueue))
 (export "memory" (memory $0))
 (func $assembly/renderqueue/yOff (param $0 i32) (result i32)
  i32.const 0
  return
 )
 (func $assembly/renderqueue/curVisOff (param $0 i32) (result i32)
  local.get $0
  call $assembly/renderqueue/yOff
  local.get $0
  i32.const 2
  i32.shl
  i32.add
  return
 )
 (func $assembly/renderqueue/queueOff (param $0 i32) (result i32)
  local.get $0
  call $assembly/renderqueue/curVisOff
  local.get $0
  i32.const 2
  i32.shl
  i32.add
  return
 )
 (func $assembly/renderqueue/trackedOff (param $0 i32) (result i32)
  local.get $0
  call $assembly/renderqueue/queueOff
  local.get $0
  i32.const 2
  i32.shl
  i32.add
  return
 )
 (func $assembly/renderqueue/visNowOff (param $0 i32) (result i32)
  local.get $0
  call $assembly/renderqueue/trackedOff
  local.get $0
  i32.add
  return
 )
 (func $assembly/renderqueue/keysOff (param $0 i32) (result i32)
  (local $1 i32)
  block $assembly/renderqueue/align4|inlined.0 (result i32)
   local.get $0
   call $assembly/renderqueue/visNowOff
   local.get $0
   i32.add
   local.set $1
   local.get $1
   i32.const 3
   i32.add
   i32.const 3
   i32.const -1
   i32.xor
   i32.and
   br $assembly/renderqueue/align4|inlined.0
  end
  return
 )
 (func $assembly/renderqueue/paylOff (param $0 i32) (result i32)
  local.get $0
  call $assembly/renderqueue/keysOff
  local.get $0
  i32.const 2
  i32.shl
  i32.add
  return
 )
 (func $assembly/renderqueue/keyScrOff (param $0 i32) (result i32)
  local.get $0
  call $assembly/renderqueue/paylOff
  local.get $0
  i32.const 2
  i32.shl
  i32.add
  return
 )
 (func $assembly/renderqueue/paylScrOff (param $0 i32) (result i32)
  local.get $0
  call $assembly/renderqueue/keyScrOff
  local.get $0
  i32.const 2
  i32.shl
  i32.add
  return
 )
 (func $assembly/renderqueue/countsOff (param $0 i32) (result i32)
  local.get $0
  call $assembly/renderqueue/paylScrOff
  local.get $0
  i32.const 2
  i32.shl
  i32.add
  return
 )
 (func $assembly/renderqueue/requiredBytes (param $0 i32) (result i32)
  local.get $0
  call $assembly/renderqueue/countsOff
  i32.const 1024
  i32.add
  return
 )
 (func $assembly/renderqueue/radixSortQueue (param $0 i32) (param $1 i32)
  (local $2 i32)
  (local $3 i32)
  (local $4 i32)
  (local $5 i32)
  (local $6 i32)
  (local $7 i32)
  (local $8 i32)
  (local $9 i32)
  (local $10 i32)
  (local $11 i32)
  (local $12 i32)
  (local $13 i32)
  (local $14 i32)
  (local $15 i32)
  (local $16 i32)
  (local $17 i32)
  (local $18 i32)
  (local $19 i32)
  (local $20 i32)
  (local $21 i32)
  (local $22 i32)
  (local $23 i32)
  (local $24 i32)
  (local $25 i32)
  (local $26 i32)
  (local $27 i32)
  (local $28 i32)
  (local $29 i32)
  (local $30 i32)
  (local $31 i32)
  (local $32 i32)
  (local $33 i32)
  (local $34 i32)
  (local $35 i32)
  (local $36 i32)
  local.get $0
  call $assembly/renderqueue/yOff
  local.set $2
  local.get $0
  call $assembly/renderqueue/curVisOff
  local.set $3
  local.get $0
  call $assembly/renderqueue/queueOff
  local.set $4
  local.get $0
  call $assembly/renderqueue/keysOff
  local.set $5
  local.get $0
  call $assembly/renderqueue/paylOff
  local.set $6
  local.get $0
  call $assembly/renderqueue/keyScrOff
  local.set $7
  local.get $0
  call $assembly/renderqueue/paylScrOff
  local.set $8
  local.get $0
  call $assembly/renderqueue/countsOff
  local.set $9
  i32.const 0
  local.set $10
  loop $for-loop|0
   local.get $10
   local.get $1
   i32.lt_s
   if
    local.get $3
    local.get $10
    i32.const 2
    i32.shl
    i32.add
    i32.load
    local.set $11
    local.get $2
    local.get $11
    i32.const 2
    i32.shl
    i32.add
    f32.load
    i32.reinterpret_f32
    local.set $12
    local.get $5
    local.get $10
    i32.const 2
    i32.shl
    i32.add
    block $assembly/renderqueue/floatFlip|inlined.0 (result i32)
     local.get $12
     local.set $13
     i32.const 0
     local.get $13
     i32.const 31
     i32.shr_u
     i32.sub
     i32.const -2147483648
     i32.or
     local.set $14
     local.get $13
     local.get $14
     i32.xor
     br $assembly/renderqueue/floatFlip|inlined.0
    end
    i32.store
    local.get $6
    local.get $10
    i32.const 2
    i32.shl
    i32.add
    local.get $11
    i32.store
    local.get $10
    i32.const 1
    i32.add
    local.set $10
    br $for-loop|0
   end
  end
  local.get $5
  local.set $15
  local.get $6
  local.set $16
  local.get $7
  local.set $17
  local.get $8
  local.set $18
  i32.const 0
  local.set $19
  loop $for-loop|1
   local.get $19
   i32.const 32
   i32.lt_s
   if
    i32.const 0
    local.set $20
    loop $for-loop|2
     local.get $20
     i32.const 256
     i32.lt_s
     if
      local.get $9
      local.get $20
      i32.const 2
      i32.shl
      i32.add
      i32.const 0
      i32.store
      local.get $20
      i32.const 1
      i32.add
      local.set $20
      br $for-loop|2
     end
    end
    i32.const 0
    local.set $21
    loop $for-loop|3
     local.get $21
     local.get $1
     i32.lt_s
     if
      local.get $15
      local.get $21
      i32.const 2
      i32.shl
      i32.add
      i32.load
      local.get $19
      i32.shr_u
      i32.const 255
      i32.and
      local.set $22
      local.get $9
      local.get $22
      i32.const 2
      i32.shl
      i32.add
      local.set $23
      local.get $23
      local.get $23
      i32.load
      i32.const 1
      i32.add
      i32.store
      local.get $21
      i32.const 1
      i32.add
      local.set $21
      br $for-loop|3
     end
    end
    i32.const 0
    local.set $24
    i32.const 0
    local.set $25
    loop $for-loop|4
     local.get $25
     i32.const 256
     i32.lt_s
     if
      local.get $9
      local.get $25
      i32.const 2
      i32.shl
      i32.add
      local.set $26
      local.get $26
      i32.load
      local.set $27
      local.get $26
      local.get $24
      i32.store
      local.get $24
      local.get $27
      i32.add
      local.set $24
      local.get $25
      i32.const 1
      i32.add
      local.set $25
      br $for-loop|4
     end
    end
    i32.const 0
    local.set $28
    loop $for-loop|5
     local.get $28
     local.get $1
     i32.lt_s
     if
      local.get $15
      local.get $28
      i32.const 2
      i32.shl
      i32.add
      i32.load
      local.set $29
      local.get $16
      local.get $28
      i32.const 2
      i32.shl
      i32.add
      i32.load
      local.set $30
      local.get $29
      local.get $19
      i32.shr_u
      i32.const 255
      i32.and
      local.set $31
      local.get $9
      local.get $31
      i32.const 2
      i32.shl
      i32.add
      local.set $32
      local.get $32
      i32.load
      local.set $33
      local.get $17
      local.get $33
      i32.const 2
      i32.shl
      i32.add
      local.get $29
      i32.store
      local.get $18
      local.get $33
      i32.const 2
      i32.shl
      i32.add
      local.get $30
      i32.store
      local.get $32
      local.get $33
      i32.const 1
      i32.add
      i32.store
      local.get $28
      i32.const 1
      i32.add
      local.set $28
      br $for-loop|5
     end
    end
    local.get $15
    local.set $34
    local.get $17
    local.set $15
    local.get $34
    local.set $17
    local.get $16
    local.set $35
    local.get $18
    local.set $16
    local.get $35
    local.set $18
    local.get $19
    i32.const 8
    i32.add
    local.set $19
    br $for-loop|1
   end
  end
  i32.const 0
  local.set $36
  loop $for-loop|6
   local.get $36
   local.get $1
   i32.lt_s
   if
    local.get $4
    local.get $36
    i32.const 2
    i32.shl
    i32.add
    local.get $16
    local.get $36
    i32.const 2
    i32.shl
    i32.add
    i32.load
    i32.store
    local.get $36
    i32.const 1
    i32.add
    local.set $36
    br $for-loop|6
   end
  end
 )
 (func $assembly/renderqueue/reinsertUpdateQueue (param $0 i32) (param $1 i32) (param $2 i32) (result i32)
  (local $3 i32)
  (local $4 i32)
  (local $5 i32)
  (local $6 i32)
  (local $7 i32)
  (local $8 i32)
  (local $9 i32)
  (local $10 i32)
  (local $11 i32)
  (local $12 i32)
  (local $13 i32)
  (local $14 i32)
  (local $15 i32)
  (local $16 f32)
  (local $17 i32)
  (local $18 i32)
  (local $19 f32)
  local.get $0
  call $assembly/renderqueue/yOff
  local.set $3
  local.get $0
  call $assembly/renderqueue/curVisOff
  local.set $4
  local.get $0
  call $assembly/renderqueue/queueOff
  local.set $5
  local.get $0
  call $assembly/renderqueue/trackedOff
  local.set $6
  local.get $0
  call $assembly/renderqueue/visNowOff
  local.set $7
  i32.const 0
  local.set $8
  loop $for-loop|0
   local.get $8
   local.get $1
   i32.lt_s
   if
    local.get $7
    local.get $4
    local.get $8
    i32.const 2
    i32.shl
    i32.add
    i32.load
    i32.add
    i32.const 1
    i32.store8
    local.get $8
    i32.const 1
    i32.add
    local.set $8
    br $for-loop|0
   end
  end
  i32.const 0
  local.set $9
  i32.const 0
  local.set $10
  loop $for-loop|1
   local.get $10
   local.get $2
   i32.lt_s
   if
    local.get $5
    local.get $10
    i32.const 2
    i32.shl
    i32.add
    i32.load
    local.set $11
    local.get $7
    local.get $11
    i32.add
    i32.load8_u
    i32.const 1
    i32.eq
    if
     local.get $5
     local.get $9
     i32.const 2
     i32.shl
     i32.add
     local.get $11
     i32.store
     local.get $9
     i32.const 1
     i32.add
     local.set $9
    else
     local.get $6
     local.get $11
     i32.add
     i32.const 0
     i32.store8
    end
    local.get $10
    i32.const 1
    i32.add
    local.set $10
    br $for-loop|1
   end
  end
  i32.const 0
  local.set $12
  loop $for-loop|2
   local.get $12
   local.get $1
   i32.lt_s
   if
    local.get $4
    local.get $12
    i32.const 2
    i32.shl
    i32.add
    i32.load
    local.set $13
    local.get $6
    local.get $13
    i32.add
    i32.load8_u
    i32.const 0
    i32.eq
    if
     local.get $5
     local.get $9
     i32.const 2
     i32.shl
     i32.add
     local.get $13
     i32.store
     local.get $9
     i32.const 1
     i32.add
     local.set $9
     local.get $6
     local.get $13
     i32.add
     i32.const 1
     i32.store8
    end
    local.get $7
    local.get $13
    i32.add
    i32.const 0
    i32.store8
    local.get $12
    i32.const 1
    i32.add
    local.set $12
    br $for-loop|2
   end
  end
  i32.const 1
  local.set $14
  loop $for-loop|3
   local.get $14
   local.get $9
   i32.lt_s
   if
    local.get $5
    local.get $14
    i32.const 2
    i32.shl
    i32.add
    i32.load
    local.set $15
    local.get $3
    local.get $15
    i32.const 2
    i32.shl
    i32.add
    f32.load
    local.set $16
    local.get $14
    i32.const 1
    i32.sub
    local.set $17
    block $while-break|4
     loop $while-continue|4
      local.get $17
      i32.const 0
      i32.ge_s
      if
       local.get $5
       local.get $17
       i32.const 2
       i32.shl
       i32.add
       i32.load
       local.set $18
       local.get $3
       local.get $18
       i32.const 2
       i32.shl
       i32.add
       f32.load
       local.set $19
       local.get $19
       local.get $16
       f32.le
       if
        br $while-break|4
       end
       local.get $5
       local.get $17
       i32.const 1
       i32.add
       i32.const 2
       i32.shl
       i32.add
       local.get $18
       i32.store
       local.get $17
       i32.const 1
       i32.sub
       local.set $17
       br $while-continue|4
      end
     end
    end
    local.get $5
    local.get $17
    i32.const 1
    i32.add
    i32.const 2
    i32.shl
    i32.add
    local.get $15
    i32.store
    local.get $14
    i32.const 1
    i32.add
    local.set $14
    br $for-loop|3
   end
  end
  local.get $9
  return
 )
)
