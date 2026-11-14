"""Repairs Mantaflow's Python classes in Blender-as-a-module (bpy from PyPI, seen in 5.2.3 on CPython 3.13).

Mantaflow copies each parent class's methods into its children when its `manta` module is created. In the
bpy module that happens before the parents have been looked up, so every class comes out flat: a
LevelsetGrid has no setConst, a FlagGrid no initDomain, and the solver script Blender generates fails on its
first lines ("'LevelsetGrid' object has no attribute 'setConst'"). The stand-alone Blender program does not
have the fault.

The classes are static C types, so the missing links cannot be assigned from Python. This writes them
straight into the type objects (base, bases and method resolution order), which gives each class its
parents' methods exactly as the copy would have. Call `repair()` once, after `import bpy` and before the
first fluid domain is evaluated. It does nothing when the classes are already whole.
"""
import ctypes, sys

PARENT = {
    'Solver': 'PbClass', 'GridBase': 'PbClass', 'Grid4dBase': 'PbClass', 'Mesh': 'PbClass', 'MeshDataBase': 'PbClass',
    'ParticleBase': 'PbClass', 'ParticleDataBase': 'PbClass', 'Shape': 'PbClass', 'NoiseField': 'PbClass', 'Timings': 'PbClass',
    'MovingObstacle': 'PbClass',
    'Grid_Real': 'GridBase', 'Grid_Vec3': 'GridBase', 'Grid_int': 'GridBase',
    'LevelsetGrid': 'Grid_Real', 'MACGrid': 'Grid_Vec3', 'FlagGrid': 'Grid_int',
    'Grid4d_int': 'Grid4dBase', 'Grid4d_Real': 'Grid4dBase', 'Grid4d_Vec3': 'Grid4dBase', 'Grid4d_Vec4': 'Grid4dBase',
    'MeshDataImpl_int': 'MeshDataBase', 'MeshDataImpl_Real': 'MeshDataBase', 'MeshDataImpl_Vec3': 'MeshDataBase',
    'VortexSheetMesh': 'Mesh',
    'ParticleSystem_BasicParticleData': 'ParticleBase', 'ParticleSystem_ParticleIndexData': 'ParticleBase',
    'ParticleSystem_TurbulenceParticleData': 'ParticleBase', 'ParticleSystem_VortexParticleData': 'ParticleBase',
    'BasicParticleSystem': 'ParticleSystem_BasicParticleData', 'ParticleIndexSystem': 'ParticleSystem_ParticleIndexData',
    'TurbulenceParticleSystem': 'ParticleSystem_TurbulenceParticleData', 'VortexParticleSystem': 'ParticleSystem_VortexParticleData',
    'ParticleDataImpl_Real': 'ParticleDataBase', 'ParticleDataImpl_Vec3': 'ParticleDataBase', 'ParticleDataImpl_int': 'ParticleDataBase',
    'Box': 'Shape', 'Cylinder': 'Shape', 'NullShape': 'Shape', 'Slope': 'Shape', 'Sphere': 'Shape',
}
# Offsets of tp_base, tp_bases and tp_mro in PyTypeObject on 64-bit CPython 3.8 to 3.13.
TP_BASE, TP_BASES, TP_MRO = 256, 336, 344


def repair():
    import manta
    if manta.LevelsetGrid.__mro__ != (manta.LevelsetGrid, object): return False
    if ctypes.sizeof(ctypes.c_void_p) != 8 or sys.version_info[:2] > (3, 13) or sys.implementation.name != 'cpython':
        raise RuntimeError('manta_bases: untested interpreter, check the PyTypeObject offsets')
    read = lambda t, off: ctypes.c_void_p.from_address(id(t) + off).value
    # the offsets, proved on a type whose answers are known
    assert read(bool, TP_BASE) == id(int) and read(bool, TP_BASES) == id(bool.__bases__) and read(bool, TP_MRO) == id(bool.__mro__)
    classes = {}
    for name in dir(manta):
        c = getattr(manta, name)
        if isinstance(c, type): classes[c.__name__] = c
    keep = repair.keep = []            # the tuples written into the types must outlive them
    def chain(name):
        out = [classes[name]]
        while name in PARENT: name = PARENT[name]; out.append(classes[name])
        return out
    for name in PARENT:
        if name not in classes: continue
        line = chain(name); cls = line[0]
        bases, mro = (line[1],), tuple(line) + (object,)
        keep.extend((bases, mro))
        for off, value in ((TP_BASE, line[1]), (TP_BASES, bases), (TP_MRO, mro)):
            ctypes.pythonapi.Py_IncRef(ctypes.py_object(value))
            ctypes.c_void_p.from_address(id(cls) + off).value = id(value)
    for cls in classes.values(): ctypes.pythonapi.PyType_Modified(ctypes.py_object(cls))
    assert hasattr(manta.LevelsetGrid, 'setConst') and issubclass(manta.FlagGrid, manta.GridBase)
    return True
