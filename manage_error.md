INFO:     127.0.0.1:52986 - "POST /api/branches/67/superadmin-access HTTP/1.1" 500 Internal Server Error
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
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\middleware\errors.py", line 187, in __call__
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
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\middleware\dos_protection.py", line 640, in dispatch
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
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\middleware\dos_protection.py", line 569, in dispatch
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
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\middleware\dos_protection.py", line 554, in dispatch
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
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\middleware\dos_protection.py", line 545, in dispatch
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
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\main.py", line 219, in dispatch
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
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\main.py", line 152, in dispatch
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
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\fastapi\routing.py", line 212, in run_endpoint_function
    |     return await dependant.call(**values)
    |            ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    |   File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\routes\branches.py", line 347, in create_superadmin_branch_session
    |     access_token = create_access_token(
    |                    ^^^^^^^^^^^^^^^^^^^^
    | TypeError: create_access_token() got an unexpected keyword argument 'expires_delta'
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
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\starlette\middleware\errors.py", line 187, in __call__
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
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\middleware\dos_protection.py", line 640, in dispatch
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
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\middleware\dos_protection.py", line 569, in dispatch
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
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\middleware\dos_protection.py", line 554, in dispatch
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
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\middleware\dos_protection.py", line 545, in dispatch
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
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\main.py", line 219, in dispatch
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
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\main.py", line 152, in dispatch
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
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Lib\site-packages\fastapi\routing.py", line 212, in run_endpoint_function
    return await dependant.call(**values)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\routes\branches.py", line 347, in create_superadmin_branch_session
    access_token = create_access_token(
                   ^^^^^^^^^^^^^^^^^^^^
TypeError: create_access_token() got an unexpected keyword argument 'expires_delta'
