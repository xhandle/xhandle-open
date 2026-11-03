"""One-shot native memory sample for an isolated macOS benchmark process tree."""
import ctypes, json, subprocess, sys

fields='user_time system_time pkg_idle_wkups interrupt_wkups pageins wired_size resident_size phys_footprint proc_start_abstime proc_exit_abstime child_user_time child_system_time child_pkg_idle_wkups child_interrupt_wkups child_pageins child_elapsed_abstime diskio_bytesread diskio_byteswritten cpu_time_qos_default cpu_time_qos_maintenance cpu_time_qos_background cpu_time_qos_utility cpu_time_qos_legacy cpu_time_qos_user_initiated cpu_time_qos_user_interactive billed_system_time serviced_system_time logical_writes lifetime_max_phys_footprint instructions cycles billed_energy serviced_energy interval_max_phys_footprint runnable_time'.split()
class Usage(ctypes.Structure):
    _fields_=[('uuid',ctypes.c_uint8*16)]+[(name,ctypes.c_uint64)for name in fields]
lib=ctypes.CDLL('/usr/lib/libproc.dylib');lib.proc_pid_rusage.argtypes=[ctypes.c_int,ctypes.c_int,ctypes.c_void_p]
rows=[]
for line in subprocess.check_output(['ps','-ax','-o','pid=,ppid=,comm='],text=True).splitlines():
    parts=line.strip().split(None,2)
    if len(parts)==3:rows.append((int(parts[0]),int(parts[1]),parts[2]))
selected={int(sys.argv[1])}
if len(sys.argv)>2:
    for pid,_,name in rows:
        if not name.endswith('chrome_crashpad_handler'):continue
        try:
            args=subprocess.check_output(['ps','-p',str(pid),'-o','args='],text=True)
            if '--database='+sys.argv[2] in args:selected.add(pid)
        except subprocess.CalledProcessError:pass
while True:
    expanded=selected|{pid for pid,parent,_ in rows if parent in selected}
    if expanded==selected:break
    selected=expanded
result=[]
for pid,_,name in rows:
    if pid not in selected or 'python' in name or name.endswith('/ps'):continue
    usage=Usage()
    if lib.proc_pid_rusage(pid,4,ctypes.byref(usage))==0:
        result.append({'pid':pid,'role':'crash-handler'if'crashpad'in name else 'renderer'if'Renderer'in name else 'gpu'if'GPU'in name else 'main'if pid==int(sys.argv[1])else'helper','footprintBytes':usage.phys_footprint,'peakFootprintBytes':usage.lifetime_max_phys_footprint})
print(json.dumps({'availability':'available','processes':result,'totalFootprintBytes':sum(p['footprintBytes']for p in result)}))
