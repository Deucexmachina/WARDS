ERROR:    Exception in ASGI application
  + Exception Group Traceback (most recent call last):
  |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\_utils.py", line 77, in collapse_excgroups
  |     yield
  |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\middleware\base.py", line 186, in __call__
  |     async with anyio.create_task_group() as task_group:
  |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\anyio\_backends\_asyncio.py", line 799, in __aexit__
  |     raise BaseExceptionGroup(
  | ExceptionGroup: unhandled errors in a TaskGroup (1 sub-exception)
  +-+---------------- 1 ----------------
    | Traceback (most recent call last):
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\uvicorn\protocols\http\httptools_impl.py", line 401, in run_asgi
    |     result = await app(  # type: ignore[func-returns-value]
    |              ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\uvicorn\middleware\proxy_headers.py", line 60, in __call__
    |     return await self.app(scope, receive, send)
    |            ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\fastapi\applications.py", line 1054, in __call__
    |     await super().__call__(scope, receive, send)
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\applications.py", line 113, in __call__
    |     await self.middleware_stack(scope, receive, send)
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\middleware\errors.py", line 177, in __call__
    |     response = await self.handler(request, exc)
    |                ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\main.py", line 187, in production_exception_handler
    |     raise exc
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\middleware\errors.py", line 165, in __call__
    |     await self.app(scope, receive, _send)
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\middleware\base.py", line 185, in __call__
    |     with collapse_excgroups():
    |   File "C:\Program Files\WindowsApps\PythonSoftwareFoundation.Python.3.11_3.11.2544.0_x64__qbz5n2kfra8p0\Lib\contextlib.py", line 158, in __exit__
    |     self.gen.throw(typ, value, traceback)
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\_utils.py", line 83, in collapse_excgroups
    |     raise exc
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\middleware\base.py", line 187, in __call__
    |     response = await self.dispatch_func(request, call_next)
    |                ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\middleware\dos_protection.py", line 508, in dispatch
    |     return await call_next(request)
    |            ^^^^^^^^^^^^^^^^^^^^^^^^
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\middleware\base.py", line 163, in call_next
    |     raise app_exc
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\middleware\base.py", line 149, in coro
    |     await self.app(scope, receive_or_disconnect, send_no_error)
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\middleware\base.py", line 185, in __call__
    |     with collapse_excgroups():
    |   File "C:\Program Files\WindowsApps\PythonSoftwareFoundation.Python.3.11_3.11.2544.0_x64__qbz5n2kfra8p0\Lib\contextlib.py", line 158, in __exit__
    |     self.gen.throw(typ, value, traceback)
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\_utils.py", line 83, in collapse_excgroups
    |     raise exc
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\middleware\base.py", line 187, in __call__
    |     response = await self.dispatch_func(request, call_next)
    |                ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\middleware\dos_protection.py", line 441, in dispatch
    |     return await call_next(request)
    |            ^^^^^^^^^^^^^^^^^^^^^^^^
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\middleware\base.py", line 163, in call_next
    |     raise app_exc
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\middleware\base.py", line 149, in coro
    |     await self.app(scope, receive_or_disconnect, send_no_error)
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\middleware\base.py", line 185, in __call__
    |     with collapse_excgroups():
    |   File "C:\Program Files\WindowsApps\PythonSoftwareFoundation.Python.3.11_3.11.2544.0_x64__qbz5n2kfra8p0\Lib\contextlib.py", line 158, in __exit__
    |     self.gen.throw(typ, value, traceback)
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\_utils.py", line 83, in collapse_excgroups
    |     raise exc
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\middleware\base.py", line 187, in __call__
    |     response = await self.dispatch_func(request, call_next)
    |                ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\middleware\dos_protection.py", line 426, in dispatch
    |     return await asyncio.wait_for(call_next(request), timeout=REQUEST_TIMEOUT)
    |            ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    |   File "C:\Program Files\WindowsApps\PythonSoftwareFoundation.Python.3.11_3.11.2544.0_x64__qbz5n2kfra8p0\Lib\asyncio\tasks.py", line 489, in wait_for
    |     return fut.result()
    |            ^^^^^^^^^^^^
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\middleware\base.py", line 163, in call_next
    |     raise app_exc
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\middleware\base.py", line 149, in coro
    |     await self.app(scope, receive_or_disconnect, send_no_error)
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\middleware\base.py", line 185, in __call__
    |     with collapse_excgroups():
    |   File "C:\Program Files\WindowsApps\PythonSoftwareFoundation.Python.3.11_3.11.2544.0_x64__qbz5n2kfra8p0\Lib\contextlib.py", line 158, in __exit__
    |     self.gen.throw(typ, value, traceback)
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\_utils.py", line 83, in collapse_excgroups
    |     raise exc
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\middleware\base.py", line 187, in __call__
    |     response = await self.dispatch_func(request, call_next)
    |                ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\middleware\dos_protection.py", line 417, in dispatch
    |     response = await call_next(request)
    |                ^^^^^^^^^^^^^^^^^^^^^^^^
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\middleware\base.py", line 163, in call_next
    |     raise app_exc
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\middleware\base.py", line 149, in coro
    |     await self.app(scope, receive_or_disconnect, send_no_error)
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\middleware\base.py", line 185, in __call__
    |     with collapse_excgroups():
    |   File "C:\Program Files\WindowsApps\PythonSoftwareFoundation.Python.3.11_3.11.2544.0_x64__qbz5n2kfra8p0\Lib\contextlib.py", line 158, in __exit__
    |     self.gen.throw(typ, value, traceback)
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\_utils.py", line 83, in collapse_excgroups
    |     raise exc
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\middleware\base.py", line 187, in __call__
    |     response = await self.dispatch_func(request, call_next)
    |                ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\main.py", line 150, in dispatch
    |     response = await call_next(request)
    |                ^^^^^^^^^^^^^^^^^^^^^^^^
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\middleware\base.py", line 163, in call_next
    |     raise app_exc
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\middleware\base.py", line 149, in coro
    |     await self.app(scope, receive_or_disconnect, send_no_error)
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\middleware\cors.py", line 93, in __call__
    |     await self.simple_response(scope, receive, send, request_headers=headers)
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\middleware\cors.py", line 144, in simple_response
    |     await self.app(scope, receive, send)
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\middleware\exceptions.py", line 62, in __call__
    |     await wrap_app_handling_exceptions(self.app, conn)(scope, receive, send)
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\_exception_handler.py", line 62, in wrapped_app
    |     raise exc
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\_exception_handler.py", line 51, in wrapped_app
    |     await app(scope, receive, sender)
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\routing.py", line 715, in __call__
    |     await self.middleware_stack(scope, receive, send)
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\routing.py", line 735, in app
    |     await route.handle(scope, receive, send)
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\routing.py", line 288, in handle
    |     await self.app(scope, receive, send)
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\routing.py", line 76, in app
    |     await wrap_app_handling_exceptions(app, request)(scope, receive, send)
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\_exception_handler.py", line 62, in wrapped_app
    |     raise exc
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\_exception_handler.py", line 51, in wrapped_app
    |     await app(scope, receive, sender)
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\routing.py", line 73, in app
    |     response = await f(request)
    |                ^^^^^^^^^^^^^^^^
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\fastapi\routing.py", line 301, in app
    |     raw_response = await run_endpoint_function(
    |                    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\fastapi\routing.py", line 214, in run_endpoint_function
    |     return await run_in_threadpool(dependant.call, **values)
    |            ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\concurrency.py", line 39, in run_in_threadpool
    |     return await anyio.to_thread.run_sync(func, *args)
    |            ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\anyio\to_thread.py", line 63, in run_sync
    |     return await get_async_backend().run_sync_in_worker_thread(
    |            ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\anyio\_backends\_asyncio.py", line 2518, in run_sync_in_worker_thread
    |     return await future
    |            ^^^^^^^^^^^^
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\anyio\_backends\_asyncio.py", line 1002, in run
    |     result = context.run(func, *args)
    |              ^^^^^^^^^^^^^^^^^^^^^^^^
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\routes\security_dashboard.py", line 342, in unread_counts
    |     viewed = _viewed_ids(db, admin.username, log_type)
    |                              ^^^^^^^^^^^^^^
    | AttributeError: 'coroutine' object has no attribute 'username'
    +------------------------------------

During handling of the above exception, another exception occurred:

Traceback (most recent call last):
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\uvicorn\protocols\http\httptools_impl.py", line 401, in run_asgi
    result = await app(  # type: ignore[func-returns-value]
             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\uvicorn\middleware\proxy_headers.py", line 60, in __call__
    return await self.app(scope, receive, send)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\fastapi\applications.py", line 1054, in __call__
    await super().__call__(scope, receive, send)
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\applications.py", line 113, in __call__
    await self.middleware_stack(scope, receive, send)
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\middleware\errors.py", line 177, in __call__
    response = await self.handler(request, exc)
               ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\main.py", line 187, in production_exception_handler 
    raise exc
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\middleware\errors.py", line 165, in __call__
    await self.app(scope, receive, _send)
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\middleware\base.py", line 185, in __call__
    with collapse_excgroups():
  File "C:\Program Files\WindowsApps\PythonSoftwareFoundation.Python.3.11_3.11.2544.0_x64__qbz5n2kfra8p0\Lib\contextlib.py", line 158, in __exit__
    self.gen.throw(typ, value, traceback)
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\_utils.py", line 83, in collapse_excgroups
    raise exc
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\middleware\base.py", line 187, in __call__
    response = await self.dispatch_func(request, call_next)
               ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\middleware\dos_protection.py", line 508, in dispatch
    return await call_next(request)
           ^^^^^^^^^^^^^^^^^^^^^^^^
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\middleware\base.py", line 163, in call_next
    raise app_exc
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\middleware\base.py", line 149, in coro
    await self.app(scope, receive_or_disconnect, send_no_error)
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\middleware\base.py", line 185, in __call__
    with collapse_excgroups():
  File "C:\Program Files\WindowsApps\PythonSoftwareFoundation.Python.3.11_3.11.2544.0_x64__qbz5n2kfra8p0\Lib\contextlib.py", line 158, in __exit__
    self.gen.throw(typ, value, traceback)
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\_utils.py", line 83, in collapse_excgroups
    raise exc
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\middleware\base.py", line 187, in __call__
    response = await self.dispatch_func(request, call_next)
               ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\middleware\dos_protection.py", line 441, in dispatch
    return await call_next(request)
           ^^^^^^^^^^^^^^^^^^^^^^^^
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\middleware\base.py", line 163, in call_next
    raise app_exc
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\middleware\base.py", line 149, in coro
    await self.app(scope, receive_or_disconnect, send_no_error)
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\middleware\base.py", line 185, in __call__
    with collapse_excgroups():
  File "C:\Program Files\WindowsApps\PythonSoftwareFoundation.Python.3.11_3.11.2544.0_x64__qbz5n2kfra8p0\Lib\contextlib.py", line 158, in __exit__
    self.gen.throw(typ, value, traceback)
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\_utils.py", line 83, in collapse_excgroups
    raise exc
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\middleware\base.py", line 187, in __call__
    response = await self.dispatch_func(request, call_next)
               ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\middleware\dos_protection.py", line 426, in dispatch
    return await asyncio.wait_for(call_next(request), timeout=REQUEST_TIMEOUT)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "C:\Program Files\WindowsApps\PythonSoftwareFoundation.Python.3.11_3.11.2544.0_x64__qbz5n2kfra8p0\Lib\asyncio\tasks.py", line 489, in wait_for
    return fut.result()
           ^^^^^^^^^^^^
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\middleware\base.py", line 163, in call_next
    raise app_exc
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\middleware\base.py", line 149, in coro
    await self.app(scope, receive_or_disconnect, send_no_error)
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\middleware\base.py", line 185, in __call__
    with collapse_excgroups():
  File "C:\Program Files\WindowsApps\PythonSoftwareFoundation.Python.3.11_3.11.2544.0_x64__qbz5n2kfra8p0\Lib\contextlib.py", line 158, in __exit__
    self.gen.throw(typ, value, traceback)
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\_utils.py", line 83, in collapse_excgroups
    raise exc
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\middleware\base.py", line 187, in __call__
    response = await self.dispatch_func(request, call_next)
               ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\middleware\dos_protection.py", line 417, in dispatch
    response = await call_next(request)
               ^^^^^^^^^^^^^^^^^^^^^^^^
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\middleware\base.py", line 163, in call_next
    raise app_exc
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\middleware\base.py", line 149, in coro
    await self.app(scope, receive_or_disconnect, send_no_error)
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\middleware\base.py", line 185, in __call__
    with collapse_excgroups():
  File "C:\Program Files\WindowsApps\PythonSoftwareFoundation.Python.3.11_3.11.2544.0_x64__qbz5n2kfra8p0\Lib\contextlib.py", line 158, in __exit__
    self.gen.throw(typ, value, traceback)
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\_utils.py", line 83, in collapse_excgroups
    raise exc
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\middleware\base.py", line 187, in __call__
    response = await self.dispatch_func(request, call_next)
               ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\main.py", line 150, in dispatch
    response = await call_next(request)
               ^^^^^^^^^^^^^^^^^^^^^^^^
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\middleware\base.py", line 163, in call_next
    raise app_exc
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\middleware\base.py", line 149, in coro
    await self.app(scope, receive_or_disconnect, send_no_error)
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\middleware\cors.py", line 93, in __call__
    await self.simple_response(scope, receive, send, request_headers=headers)
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\middleware\cors.py", line 144, in simple_response
    await self.app(scope, receive, send)
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\middleware\exceptions.py", line 62, in __call__
    await wrap_app_handling_exceptions(self.app, conn)(scope, receive, send)
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\_exception_handler.py", line 62, in wrapped_app
    raise exc
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\_exception_handler.py", line 51, in wrapped_app
    await app(scope, receive, sender)
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\routing.py", line 715, in __call__
    await self.middleware_stack(scope, receive, send)
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\routing.py", line 735, in app
    await route.handle(scope, receive, send)
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\routing.py", line 288, in handle
    await self.app(scope, receive, send)
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\routing.py", line 76, in app
    await wrap_app_handling_exceptions(app, request)(scope, receive, send)
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\_exception_handler.py", line 62, in wrapped_app
    raise exc
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\_exception_handler.py", line 51, in wrapped_app
    await app(scope, receive, sender)
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\routing.py", line 73, in app
    response = await f(request)
               ^^^^^^^^^^^^^^^^
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\fastapi\routing.py", line 301, in app
    raw_response = await run_endpoint_function(
                   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\fastapi\routing.py", line 214, in run_endpoint_function
    return await run_in_threadpool(dependant.call, **values)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\concurrency.py", line 39, in run_in_threadpool
    return await anyio.to_thread.run_sync(func, *args)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\anyio\to_thread.py", line 63, in run_sync
    return await get_async_backend().run_sync_in_worker_thread(
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\anyio\_backends\_asyncio.py", line 2518, in run_sync_in_worker_thread
    return await future
           ^^^^^^^^^^^^
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\anyio\_backends\_asyncio.py", line 1002, in run
    result = context.run(func, *args)
             ^^^^^^^^^^^^^^^^^^^^^^^^
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\routes\security_dashboard.py", line 342, in unread_counts
    viewed = _viewed_ids(db, admin.username, log_type)
                             ^^^^^^^^^^^^^^
AttributeError: 'coroutine' object has no attribute 'username'
INFO:     127.0.0.1:60803 - "GET /api/security/unread-counts HTTP/1.1" 500 Internal Server Error
INFO:     127.0.0.1:63196 - "GET /api/dashboard/statistics HTTP/1.1" 200 OK
INFO:     127.0.0.1:58099 - "GET /api/discrepancies/admin HTTP/1.1" 200 OK
INFO:     127.0.0.1:65354 - "GET /api/accounts/?page=1&page_size=1 HTTP/1.1" 200 OK
INFO:     127.0.0.1:60410 - "GET /api/reports/?page=1&page_size=5 HTTP/1.1" 200 OK
INFO:     127.0.0.1:58099 - "GET /api/accounts/?page=1&page_size=1 HTTP/1.1" 200 OK
INFO:     127.0.0.1:63196 - "GET /api/reports/?page=1&page_size=5 HTTP/1.1" 200 OK
C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\sqlalchemy\engine\reflection.py:98: RuntimeWarning: coroutine 'get_current_admin_from_token' was never awaited
  tuple(
RuntimeWarning: Enable tracemalloc to get the object allocation traceback