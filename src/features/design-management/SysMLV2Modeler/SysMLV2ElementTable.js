import React from "react";

export default function SysMLV2ElementTable({ model, onSelect }) {
  return (
    <div className="overflow-auto bg-white">
      <table className="w-full text-left text-xs">
        <thead className="bg-gray-50 text-gray-600">
          <tr>
            <th className="px-3 py-2">Name</th>
            <th className="px-3 py-2">Type</th>
            <th className="px-3 py-2">Qualified Name</th>
            <th className="px-3 py-2">Description</th>
          </tr>
        </thead>
        <tbody>
          {(model?.elements || []).map((element) => (
            <tr key={element.id} className="cursor-pointer border-t hover:bg-indigo-50" onClick={() => onSelect({ kind: "element", id: element.id })}>
              <td className="px-3 py-2 font-medium">{element.name}</td>
              <td className="px-3 py-2">{element.type}</td>
              <td className="px-3 py-2 text-gray-500">{element.qualifiedName}</td>
              <td className="max-w-[360px] truncate px-3 py-2 text-gray-600">{element.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
